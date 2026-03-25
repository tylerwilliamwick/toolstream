// src/proxy-server.ts - Main MCP proxy server

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolStreamConfig } from "./types.js";
import type { SessionManager } from "./session-manager.js";
import type { SemanticRouter } from "./semantic-router.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { UpstreamManager } from "./upstream-manager.js";
import type { DependencyResolver } from "./dependency-resolver.js";
import type { ToolStreamDatabase } from "./database.js";
import { isMetaTool } from "./meta-tools.js";
import { logger } from "./logger.js";

export class ProxyServer {
  private server: Server;
  private sessionManager: SessionManager;
  private semanticRouter: SemanticRouter;
  private registry: ToolRegistry;
  private upstreamManager: UpstreamManager;
  private dependencyResolver: DependencyResolver;
  private db: ToolStreamDatabase | null;
  private config: ToolStreamConfig;
  private currentSessionId: string | null = null;
  private sessionCallSequence: Map<string, number> = new Map();

  constructor(
    config: ToolStreamConfig,
    sessionManager: SessionManager,
    semanticRouter: SemanticRouter,
    registry: ToolRegistry,
    upstreamManager: UpstreamManager,
    dependencyResolver: DependencyResolver,
    db?: ToolStreamDatabase
  ) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.semanticRouter = semanticRouter;
    this.registry = registry;
    this.upstreamManager = upstreamManager;
    this.dependencyResolver = dependencyResolver;
    this.db = db ?? null;

    this.server = new Server(
      {
        name: "toolstream",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: { listChanged: true },
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle tools/list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!this.currentSessionId) {
        const session = this.sessionManager.createSession();
        this.currentSessionId = session.id;
      }

      const tools = this.sessionManager.getVisibleTools(this.currentSessionId);
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    });

    // Handle tools/call
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!this.currentSessionId) {
        const session = this.sessionManager.createSession();
        this.currentSessionId = session.id;
      }

      // Update context with the tool call for future routing
      this.sessionManager.updateContext(
        this.currentSessionId,
        `Tool call: ${name} ${JSON.stringify(args)}`
      );

      // Handle meta-tools
      if (isMetaTool(name)) {
        return this.handleMetaTool(name, args || {});
      }

      // Handle surfaced tool calls
      const resolved = this.sessionManager.resolveToolCall(
        this.currentSessionId,
        name
      );
      if (resolved) {
        try {
          const result = await this.upstreamManager.callTool(
            resolved.serverId,
            resolved.originalName,
            (args || {}) as Record<string, unknown>
          );
          this.recordAnalytics(`${resolved.serverId}:${resolved.originalName}`);
          return result;
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error calling ${name}: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${name}. Use discover_tools to find available tools.`,
          },
        ],
        isError: true,
      };
    });
  }

  private async handleMetaTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<any> {
    switch (name) {
      case "discover_servers": {
        const servers = this.registry.getAllServers();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                servers.map((s) => ({
                  id: s.id,
                  name: s.displayName,
                  tool_count: s.toolCount,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case "discover_tools": {
        const query = args.query as string;
        const topK = (args.top_k as number) || 10;

        if (!query) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "query parameter is required" }),
              },
            ],
            isError: true,
          };
        }

        const results = await this.semanticRouter.search(query, topK);

        // Surface discovered tools into the session
        if (this.currentSessionId && results.length > 0) {
          const toolsToSurface = results.map((r) => ({
            ...r,
            source: "meta_tool" as const,
          }));
          this.sessionManager.surfaceTools(
            this.currentSessionId,
            toolsToSurface
          );

          // Resolve dependencies for surfaced tools
          for (const result of results) {
            const deps = this.dependencyResolver.resolveDependencies(
              result.tool
            );
            if (deps.length > 0) {
              this.sessionManager.surfaceToolsDirect(
                this.currentSessionId,
                deps,
                "dependency"
              );
            }
          }

          // Notify client that tool list changed
          await this.notifyToolsChanged();
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                results.map((r) => ({
                  server: r.tool.serverId,
                  tool: r.tool.toolName,
                  description: r.tool.description,
                  relevance_score: Math.round(r.score * 1000) / 1000,
                  input_schema: r.tool.inputSchema,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case "execute_tool": {
        const server = args.server as string;
        const tool = args.tool as string;
        const toolArgs = (args.arguments || {}) as Record<string, unknown>;

        if (!server || !tool) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "server and tool parameters are required",
                }),
              },
            ],
            isError: true,
          };
        }

        // Check if the tool exists
        const toolRecord = this.registry.getToolByServerAndName(server, tool);
        if (!toolRecord) {
          const closest = this.registry.findClosestTool(tool);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "tool_not_found",
                  tool_name: tool,
                  suggestion: closest || undefined,
                }),
              },
            ],
            isError: true,
          };
        }

        if (!this.upstreamManager.isConnected(server)) {
          const conn = this.upstreamManager.getConnection(server);
          if (conn?.reconnecting) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: "server_reconnecting", server_id: server, message: "Server is reconnecting. Retry in a few seconds." }) }],
              isError: true,
            };
          }
          // Permanently failed or never connected — kick off a fresh reconnect
          this.upstreamManager.forceReconnect(server);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "server_not_connected", server_id: server, message: "Reconnect initiated. Retry in ~5 seconds." }) }],
            isError: true,
          };
        }

        try {
          const result = await this.upstreamManager.callTool(
            server,
            tool,
            toolArgs
          );
          this.recordAnalytics(`${server}:${tool}`);
          return result;
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "reconnect_server": {
        const serverId = args.server_id as string;
        if (!serverId) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "server_id parameter is required" }) }],
            isError: true,
          };
        }
        const conn = this.upstreamManager.getConnection(serverId);
        if (!conn) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: "unknown_server", server_id: serverId }) }],
            isError: true,
          };
        }
        this.upstreamManager.forceReconnect(serverId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ status: "reconnecting", server_id: serverId, message: "Reconnect scheduled. Retry execute_tool in ~5 seconds." }) }],
        };
      }

      default:
        return {
          content: [
            { type: "text" as const, text: `Unknown meta-tool: ${name}` },
          ],
          isError: true,
        };
    }
  }

  private async notifyToolsChanged(): Promise<void> {
    try {
      await this.server.notification({
        method: "notifications/tools/list_changed",
      });
    } catch {
      // Notification failures are non-fatal
    }
  }

  private recordAnalytics(toolId: string): void {
    if (!this.db || !this.currentSessionId) return;
    try {
      const sessionId = this.currentSessionId;
      const seq = (this.sessionCallSequence.get(sessionId) ?? 0) + 1;
      this.sessionCallSequence.set(sessionId, seq);

      this.db.recordToolCall(toolId, sessionId, seq);

      // Fire-and-forget co-occurrence: pair with all other tools called in this session
      const others = this.db.getSessionToolCalls(sessionId);
      for (const other of others) {
        if (other.tool_id !== toolId) {
          try {
            this.db.incrementCooccurrence(toolId, other.tool_id);
          } catch (err) {
            logger.error(`[ProxyServer] Co-occurrence write failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } catch (err) {
      logger.error(`[ProxyServer] Analytics recording failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async routeContext(contextText: string): Promise<void> {
    try {
      if (!this.currentSessionId) return;

      this.sessionManager.updateContext(this.currentSessionId, contextText);

      const result = await this.semanticRouter.route(
        this.sessionManager.getSession(this.currentSessionId)?.contextBuffer || []
      );

      if (!result.belowThreshold && result.candidates.length > 0) {
        this.sessionManager.surfaceTools(
          this.currentSessionId,
          result.candidates
        );
        await this.notifyToolsChanged();
      }
    } catch (err) {
      logger.error(`[ProxyServer] Error in routeContext: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async start(injectedTransport?: Transport): Promise<void> {
    if (injectedTransport) {
      await this.server.connect(injectedTransport);
      logger.info("[ToolStream] Proxy started on injected transport");
    } else if (this.config.transport.stdio) {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info("[ToolStream] Proxy started on stdio transport");
    }
  }

  async stop(): Promise<void> {
    this.sessionManager.stopCleanup();
    await this.upstreamManager.disconnectAll();
    await this.server.close();
  }
}
