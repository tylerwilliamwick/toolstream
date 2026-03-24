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
      // HTTP transport - placeholder for future implementation
      console.warn(
        `[UpstreamManager] HTTP transport not yet implemented for server '${config.id}'`
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

    try {
      const result = await conn.client.callTool({
        name: toolName,
        arguments: args,
      });
      return result;
    } catch (err) {
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
    return this.connections.has(serverId);
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
