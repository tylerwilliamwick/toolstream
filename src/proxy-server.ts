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
import type { StrategySelector } from "./routing/strategy-selector.js";
import type { TraceStore } from "./routing/trace-store.js";
import { isMetaTool } from "./meta-tools.js";
import { logger } from "./logger.js";

// 1.30: max bytes per context entry
const MAX_CONTEXT_ENTRY_BYTES = 2048;
// 1.17: sensitive arg key pattern
const SENSITIVE_KEY_RE = /token|password|secret|key|auth|credential|apikey/i;
// 1.19: shutdown drain timeout
const SHUTDOWN_DRAIN_MS = 5000;

// 1.17: redact sensitive fields from tool args before logging
function redactSensitiveArgs(
  args: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : v;
  }
  return out;
}

// 1.24: simple counting semaphore for concurrency limiting
class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}

export class ProxyServer {
  private server: Server;
  private sessionManager: SessionManager;
  private semanticRouter: SemanticRouter;
  private registry: ToolRegistry;
  private upstreamManager: UpstreamManager;
  private dependencyResolver: DependencyResolver;
  private db: ToolStreamDatabase | null;
  private config: ToolStreamConfig;
  private strategySelector: StrategySelector | null;
  private traceStore: TraceStore | null;
  private currentSessionId: string | null = null;
  // 1.18: tracks call sequence per session (cleaned up on expiry/stop)
  private sessionCallSequence: Map<string, number> = new Map();
  // 1.8: in-memory per-session tool call sets (replaces O(N²) DB query)
  private sessionToolCalls: Map<string, Set<string>> = new Map();
  // 1.19: in-flight counter for graceful drain
  private inFlightCount = 0;
  // 1.24: concurrency semaphore
  private readonly semaphore: Semaphore;

  constructor(
    config: ToolStreamConfig,
    sessionManager: SessionManager,
    semanticRouter: SemanticRouter,
    registry: ToolRegistry,
    upstreamManager: UpstreamManager,
    dependencyResolver: DependencyResolver,
    db?: ToolStreamDatabase,
    strategySelector?: StrategySelector,
    traceStore?: TraceStore
  ) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.semanticRouter = semanticRouter;
    this.registry = registry;
    this.upstreamManager = upstreamManager;
    this.dependencyResolver = dependencyResolver;
    this.db = db ?? null;
    this.strategySelector = strategySelector ?? null;
    this.traceStore = traceStore ?? null;
    // 1.24: configurable concurrency limit (default 10)
    const maxConcurrent =
      ((config as unknown) as Record<string, unknown>)
        .maxConcurrentToolCalls as number | undefined ?? 10;
    this.semaphore = new Semaphore(maxConcurrent);

    this.server = new Server(
      {
        name: "toolstream",
        version: "2.0.0",
      },
      {
        capabilities: {
          tools: { listChanged: true },
        },
      }
    );

    this.setupHandlers();
  }

  // 1.22: detect expired session, create new one, clean up stale map entries
  private ensureSession(): void {
    if (this.currentSessionId) {
      const session = this.sessionManager.getSession(this.currentSessionId);
      if (!session) {
        // Session expired — purge stale map entries before creating new session
        this.sessionCallSequence.delete(this.currentSessionId);
        this.sessionToolCalls.delete(this.currentSessionId);
        this.currentSessionId = null;
      }
    }
    if (!this.currentSessionId) {
      const session = this.sessionManager.createSession();
      this.currentSessionId = session.id;
    }
  }

  private setupHandlers(): void {
    // Handle tools/list
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // 1.22: detect + recover from expired session
      this.ensureSession();

      const tools = this.sessionManager.getVisibleTools(this.currentSessionId!);
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

      // 1.22: detect + recover from expired session
      this.ensureSession();

      // 1.17: redact sensitive args; 1.30: truncate to 2KB
      const safeArgs = redactSensitiveArgs(args || {});
      let contextEntry = `Tool call: ${name} ${JSON.stringify(safeArgs)}`;
      if (contextEntry.length > MAX_CONTEXT_ENTRY_BYTES) {
        contextEntry = contextEntry.slice(0, MAX_CONTEXT_ENTRY_BYTES);
      }
      this.sessionManager.updateContext(this.currentSessionId!, contextEntry);

      // Handle meta-tools (not subject to concurrency limiting)
      if (isMetaTool(name)) {
        return this.handleMetaTool(name, args || {});
      }

      // 1.24: acquire semaphore slot; 1.19: track in-flight
      await this.semaphore.acquire();
      this.inFlightCount++;
      try {
        // Handle surfaced tool calls
        const resolved = this.sessionManager.resolveToolCall(
          this.currentSessionId!,
          name
        );
        if (resolved) {
          try {
            const result = await this.upstreamManager.callTool(
              resolved.serverId,
              resolved.originalName,
              (args || {}) as Record<string, unknown>
            );
            this.recordAnalytics(
              `${resolved.serverId}:${resolved.originalName}`
            );
            this.sessionManager.recordServerCall(
              this.currentSessionId!,
              resolved.serverId
            );
            return result;
          } catch (err) {
            // 1.20: normalized JSON error
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: "tool_call_failed",
                    message:
                      err instanceof Error ? err.message : String(err),
                    tool_name: name,
                  }),
                },
              ],
              isError: true,
            };
          }
        }

        // 1.20: normalized JSON error for unknown tool
        const closestMatch = this.findClosestToolName(name);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "unknown_tool",
                message: `Unknown tool: ${name}.${closestMatch ? ` Did you mean '${closestMatch}'?` : ""} Use discover_tools({query: "${name}"}) to find available tools.`,
                tool_name: name,
                closest_match: closestMatch ?? undefined,
              }),
            },
          ],
          isError: true,
        };
      } finally {
        // 1.19: always release
        this.inFlightCount--;
        this.semaphore.release();
      }
    });
  }

  private async handleMetaTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
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

          // 1.3: fire-and-forget — notification failure must not break the response
          this.notifyToolsChanged().catch((err) =>
            logger.warn(
              `[ProxyServer] notifyToolsChanged failed: ${err instanceof Error ? err.message : String(err)}`
            )
          );
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

        // 1.36: audit log — execute_tool bypasses normal session surface routing
        logger.info(
          `[Audit] execute_tool bypass: server=${server} tool=${tool} session=${this.currentSessionId ?? "none"}`
        );

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
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: "server_reconnecting",
                    server_id: server,
                    message: "Server is reconnecting. Retry in a few seconds.",
                  }),
                },
              ],
              isError: true,
            };
          }
          // Permanently failed or never connected — kick off a fresh reconnect
          this.upstreamManager.forceReconnect(server);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "server_not_connected",
                  server_id: server,
                  message: "Reconnect initiated. Retry in ~5 seconds.",
                }),
              },
            ],
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
          this.sessionManager.recordServerCall(this.currentSessionId!, server);
          return result;
        } catch (err) {
          // 1.20: normalized JSON error
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "tool_call_failed",
                  message: err instanceof Error ? err.message : String(err),
                  tool_name: tool,
                  server_id: server,
                }),
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
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "server_id parameter is required",
                }),
              },
            ],
            isError: true,
          };
        }
        const conn = this.upstreamManager.getConnection(serverId);
        if (!conn) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "unknown_server",
                  server_id: serverId,
                }),
              },
            ],
            isError: true,
          };
        }
        this.upstreamManager.forceReconnect(serverId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "reconnecting",
                server_id: serverId,
                message:
                  "Reconnect scheduled. Retry execute_tool in ~5 seconds.",
              }),
            },
          ],
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

      // 1.8: use in-memory set — O(1) lookup, avoids O(N²) DB query per call
      const sessionTools =
        this.sessionToolCalls.get(sessionId) ?? new Set<string>();
      for (const other of sessionTools) {
        if (other !== toolId) {
          try {
            this.db.incrementCooccurrence(toolId, other);
          } catch (err) {
            logger.warn(
              `[ProxyServer] Co-occurrence write failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      }
      sessionTools.add(toolId);
      this.sessionToolCalls.set(sessionId, sessionTools);
    } catch (err) {
      logger.error(
        `[ProxyServer] Analytics recording failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async routeContext(contextText: string): Promise<void> {
    try {
      if (!this.currentSessionId) return;

      this.sessionManager.updateContext(this.currentSessionId, contextText);

      const sessionContext = this.sessionManager.getSessionContext(this.currentSessionId);
      const contextBuffer = this.sessionManager.getSession(this.currentSessionId)?.contextBuffer || [];

      if (this.strategySelector && this.traceStore) {
        const strategy = this.strategySelector.pick(this.currentSessionId);
        const result = await strategy.route({
          sessionId: this.currentSessionId,
          contextBuffer,
          sessionContext,
        });
        this.traceStore.write(result.trace);

        if (!result.belowThreshold && result.candidates.length > 0) {
          this.sessionManager.surfaceTools(this.currentSessionId, result.candidates);
          await this.notifyToolsChanged();
        }
        return;
      }

      // Legacy path (no strategy selector provided)
      const result = await this.semanticRouter.route(contextBuffer, sessionContext);
      if (!result.belowThreshold && result.candidates.length > 0) {
        this.sessionManager.surfaceTools(
          this.currentSessionId,
          result.candidates
        );
        // 1.3: fire-and-forget — route context is best-effort
        this.notifyToolsChanged().catch((err) =>
          logger.warn(
            `[ProxyServer] notifyToolsChanged failed in routeContext: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    } catch (err) {
      logger.error(
        `[ProxyServer] Error in routeContext: ${err instanceof Error ? err.message : String(err)}`
      );
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
    // 1.19: drain in-flight requests before shutdown (up to 5s)
    if (this.inFlightCount > 0) {
      const deadline = Date.now() + SHUTDOWN_DRAIN_MS;
      while (this.inFlightCount > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (this.inFlightCount > 0) {
        logger.warn(
          `[ProxyServer] Shutdown with ${this.inFlightCount} in-flight calls still active`
        );
      }
    }

    // 1.18: clean up per-session maps on stop
    this.sessionCallSequence.clear();
    this.sessionToolCalls.clear();

    this.sessionManager.stopCleanup();
    await this.upstreamManager.disconnectAll();
    await this.server.close();
  }

  private findClosestToolName(name: string): string | null {
    const tools = this.registry.getAllActiveTools();
    if (tools.length === 0) return null;
    const nl = name.toLowerCase();
    let best: string | null = null;
    let bestScore = 0;
    for (const tool of tools) {
      const tl = tool.toolName.toLowerCase();
      if (tl === nl) return tool.toolName;
      let score = 0;
      if (tl.includes(nl) || nl.includes(tl)) score = 0.8;
      else {
        // common prefix ratio
        let p = 0;
        while (p < nl.length && p < tl.length && nl[p] === tl[p]) p++;
        score = p / Math.max(nl.length, tl.length);
      }
      if (score > bestScore) { bestScore = score; best = tool.toolName; }
    }
    return bestScore >= 0.3 ? best : null;
  }
}
