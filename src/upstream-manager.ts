// src/upstream-manager.ts - Manages connections to upstream MCP servers

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ServerConfig, AuthConfig } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";

interface UpstreamConnection {
  config: ServerConfig;
  client: Client;
  transport: StdioClientTransport;
  healthy: boolean;
}

export class UpstreamManager {
  private connections: Map<string, UpstreamConnection> = new Map();
  private registry: ToolRegistry;
  private failureCounts: Map<string, { count: number; firstAt: number }> = new Map();

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async connectAll(servers: ServerConfig[]): Promise<void> {
    const results = await Promise.allSettled(
      servers.map((s) => this.connectServer(s))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        console.warn(
          `[UpstreamManager] Failed to connect to server '${servers[i].id}': ${result.reason}`
        );
      }
    }
  }

  private async connectServer(config: ServerConfig): Promise<void> {
    if (config.transport === "stdio") {
      if (!config.command) {
        throw new Error(`Server '${config.id}' requires 'command' for stdio transport`);
      }

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: this.buildEnv(config.auth),
      });

      const client = new Client(
        { name: "toolstream-proxy", version: "1.0.0" },
        { capabilities: {} }
      );

      await client.connect(transport);

      transport.onclose = () => {
        const conn = this.connections.get(config.id);
        if (conn) {
          conn.healthy = false;
          console.warn(`[UpstreamManager] Server '${config.id}' disconnected`);
        }
      };

      transport.onerror = (err: Error) => {
        const conn = this.connections.get(config.id);
        if (conn) {
          conn.healthy = false;
          console.error(`[UpstreamManager] Server '${config.id}' error:`, err.message);
        }
      };

      this.connections.set(config.id, {
        config,
        client,
        transport,
        healthy: true,
      });

      // Register server in DB
      this.registry.getAllServers(); // ensure loaded
      const db = (this.registry as any).db;
      if (db) {
        db.insertServer(config.id, config.name, config.transport);
      }

      // Discover and register tools
      await this.syncTools(config.id);

      console.log(
        `[UpstreamManager] Connected to server '${config.id}' (${config.name})`
      );
    } else {
      throw new Error(
        `HTTP transport is not yet supported for server '${config.id}'. Use stdio transport instead.`
      );
    }
  }

  async syncTools(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    try {
      const result = await conn.client.listTools();
      const tools = result.tools.map((t) => ({
        name: t.name,
        description: t.description || t.name,
        inputSchema: (t.inputSchema || {
          type: "object",
          properties: {},
        }) as Record<string, unknown>,
      }));

      await this.registry.registerTools(serverId, tools);
      conn.healthy = true;
    } catch (err) {
      console.error(
        `[UpstreamManager] Failed to sync tools for server '${serverId}':`,
        err
      );
      conn.healthy = false;
    }
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<any> {
    const conn = this.connections.get(serverId);
    if (!conn) {
      throw new Error(`Server '${serverId}' not connected`);
    }
    if (!conn.healthy) {
      throw new Error(`Server '${serverId}' is in degraded state`);
    }

    const timeoutMs = 30_000;
    try {
      const result = await Promise.race([
        conn.client.callTool({ name: toolName, arguments: args }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Tool call '${toolName}' timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      // Reset failure count on success
      this.failureCounts.delete(serverId);
      return result;
    } catch (err) {
      // Track failures for circuit-breaker logic
      const now = Date.now();
      const existing = this.failureCounts.get(serverId);
      if (existing && now - existing.firstAt < 300_000) {
        existing.count += 1;
        if (existing.count > 3) {
          conn.healthy = false;
          console.warn(`[UpstreamManager] Server '${serverId}' marked unhealthy after ${existing.count} failures within 5 minutes`);
        }
      } else {
        this.failureCounts.set(serverId, { count: 1, firstAt: now });
      }

      // Check if it's an auth error
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("401") || message.includes("Unauthorized")) {
        throw new Error(
          JSON.stringify({
            error: "auth_failed",
            server_id: serverId,
            http_status: 401,
          })
        );
      }
      throw err;
    }
  }

  getServerStatus(): Array<{
    id: string;
    name: string;
    healthy: boolean;
    toolCount: number;
  }> {
    const status: Array<{
      id: string;
      name: string;
      healthy: boolean;
      toolCount: number;
    }> = [];

    for (const [id, conn] of this.connections) {
      const serverRecord = this.registry
        .getAllServers()
        .find((s) => s.id === id);
      status.push({
        id,
        name: conn.config.name,
        healthy: conn.healthy,
        toolCount: serverRecord?.toolCount ?? 0,
      });
    }

    return status;
  }

  isConnected(serverId: string): boolean {
    return this.connections.get(serverId)?.healthy ?? false;
  }

  async disconnectAll(): Promise<void> {
    for (const [id, conn] of this.connections) {
      try {
        await conn.transport.close();
      } catch {
        console.warn(`[UpstreamManager] Error disconnecting server '${id}'`);
      }
    }
    this.connections.clear();
  }

  private buildEnv(auth: AuthConfig): Record<string, string> {
    const env: Record<string, string> = { ...process.env } as Record<
      string,
      string
    >;

    if (auth.type === "env" || auth.type === "bearer") {
      if (auth.tokenEnv) {
        const token = process.env[auth.tokenEnv];
        if (token) {
          env[auth.tokenEnv] = token;
        }
      }
    }

    return env;
  }

  getAuthHeaders(serverId: string): Record<string, string> {
    const conn = this.connections.get(serverId);
    if (!conn) return {};

    const auth = conn.config.auth;
    if (auth.type === "bearer" && auth.tokenEnv) {
      const token = process.env[auth.tokenEnv];
      if (token) {
        return { Authorization: `Bearer ${token}` };
      }
    }
    if (auth.type === "header" && auth.headerName && auth.tokenEnv) {
      const token = process.env[auth.tokenEnv];
      if (token) {
        return { [auth.headerName]: token };
      }
    }
    return {};
  }
}
