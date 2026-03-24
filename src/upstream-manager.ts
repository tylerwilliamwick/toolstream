// src/upstream-manager.ts - Manages connections to upstream MCP servers

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ServerConfig, AuthConfig } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";
import { logger } from "./logger.js";

export interface UpstreamConnection {
  config: ServerConfig;
  client: Client;
  transport: StdioClientTransport;
  healthy: boolean;
  reconnecting: boolean;
}

const CONNECT_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

export class UpstreamManager {
  private connections: Map<string, UpstreamConnection> = new Map();
  private registry: ToolRegistry;
  private failureCounts: Map<string, { count: number; firstAt: number }> = new Map();
  private eventListeners: Map<string, Array<(serverId: string) => void>> = new Map();

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  public on(event: string, callback: (serverId: string) => void): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.push(callback);
    this.eventListeners.set(event, listeners);
  }

  private emit(event: string, serverId: string): void {
    const listeners = this.eventListeners.get(event) || [];
    for (const cb of listeners) {
      try { cb(serverId); } catch { /* don't let listener errors break the manager */ }
    }
  }

  async connectAll(servers: ServerConfig[]): Promise<void> {
    const results = await Promise.allSettled(
      servers.map((s) => this.connectServer(s))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        logger.warn(
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
        env: this.buildEnv(config),
      });

      const client = new Client(
        { name: "toolstream-proxy", version: "1.0.0" },
        { capabilities: {} }
      );

      await withTimeout(
        client.connect(transport),
        CONNECT_TIMEOUT_MS,
        `connect to '${config.id}'`
      );

      transport.onclose = () => {
        const conn = this.connections.get(config.id);
        if (conn) {
          conn.healthy = false;
          this.scheduleReconnect(config.id);
        }
      };

      transport.onerror = (err: Error) => {
        const conn = this.connections.get(config.id);
        if (conn) {
          conn.healthy = false;
          logger.error(`[UpstreamManager] Server '${config.id}' error: ${err.message}`);
        }
      };

      this.connections.set(config.id, {
        config,
        client,
        transport,
        healthy: true,
        reconnecting: false,
      });

      // Register server in DB
      this.registry.getAllServers(); // ensure loaded
      const db = (this.registry as any).db;
      if (db) {
        db.insertServer(config.id, config.name, config.transport);
      }

      // Discover and register tools
      await this.syncTools(config.id);

      logger.info(
        `[UpstreamManager] Connected to server '${config.id}' (${config.name})`
      );
    } else {
      throw new Error(
        `HTTP transport is not yet supported for server '${config.id}'. Use stdio transport instead.`
      );
    }
  }

  public scheduleReconnect(serverId: string): void {
    const conn = this.connections.get(serverId);
    if (!conn || conn.reconnecting) return; // Guard against duplicate calls

    conn.reconnecting = true;
    conn.healthy = false;

    this.attemptReconnect(serverId, 0);
  }

  public forceReconnect(serverId: string): void {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    // Reset reconnecting flag so scheduleReconnect won't no-op
    conn.reconnecting = false;
    this.scheduleReconnect(serverId);
  }

  private attemptReconnect(serverId: string, attempt: number): void {
    const MAX_ATTEMPTS = 10;
    const conn = this.connections.get(serverId);
    if (!conn) return;

    if (attempt >= MAX_ATTEMPTS) {
      logger.error(`[UpstreamManager] Server '${serverId}' permanently failed after ${MAX_ATTEMPTS} attempts`);
      conn.reconnecting = false;
      // Emit event for notification system
      this.emit('server_permanently_failed', serverId);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // 1s, 2s, 4s... max 30s
    logger.warn(`[UpstreamManager] Reconnecting to '${serverId}' in ${delay}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);

    setTimeout(async () => {
      try {
        await this.reconnect(serverId);
        logger.info(`[UpstreamManager] Reconnected to '${serverId}' successfully`);
      } catch (err) {
        logger.error(`[UpstreamManager] Reconnect attempt ${attempt + 1} failed for '${serverId}': ${err instanceof Error ? err.message : String(err)}`);
        this.attemptReconnect(serverId, attempt + 1);
      }
    }, delay);
  }

  private async reconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection found for '${serverId}'`);

    // Tear down old transport
    try {
      await conn.transport.close();
    } catch {
      // Already closed, ignore
    }

    // Create new transport and client
    const config = conn.config;
    const transport = new StdioClientTransport({
      command: config.command!,
      args: config.args || [],
      env: this.buildEnv(config),
    });

    const client = new Client(
      { name: "toolstream-proxy", version: "1.0.0" },
      { capabilities: {} }
    );

    await withTimeout(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      `reconnect to '${serverId}'`
    );

    // Attach listeners to new transport
    transport.onclose = () => {
      const c = this.connections.get(serverId);
      if (c) {
        c.healthy = false;
        this.scheduleReconnect(serverId);
      }
    };

    transport.onerror = (err: Error) => {
      const c = this.connections.get(serverId);
      if (c) {
        c.healthy = false;
        logger.error(`[UpstreamManager] Server '${serverId}' error: ${err.message}`);
      }
    };

    // Update the connection in the Map
    conn.client = client;
    conn.transport = transport;
    conn.healthy = true;
    conn.reconnecting = false;

    // Re-sync tools (skip embedBatch for tools that already have embeddings)
    await this.syncTools(serverId);
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
      logger.error(
        `[UpstreamManager] Failed to sync tools for server '${serverId}': ${err instanceof Error ? err.message : String(err)}`
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
          logger.warn(`[UpstreamManager] Server '${serverId}' marked unhealthy after ${existing.count} failures within 5 minutes`);
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

  getConnection(serverId: string): UpstreamConnection | undefined {
    return this.connections.get(serverId);
  }

  isConnected(serverId: string): boolean {
    return this.connections.get(serverId)?.healthy ?? false;
  }

  async disconnectAll(): Promise<void> {
    for (const [id, conn] of this.connections) {
      try {
        await conn.transport.close();
      } catch {
        logger.warn(`[UpstreamManager] Error disconnecting server '${id}'`);
      }
    }
    this.connections.clear();
  }

  private buildEnv(config: ServerConfig): Record<string, string> {
    // Security: allowlist-only environment for child processes.
    // Only pass PATH, HOME, and explicitly listed env vars.
    const env: Record<string, string> = {
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
      HOME: process.env.HOME || "",
      NODE_ENV: process.env.NODE_ENV || "production",
    };

    // Pass auth token if configured
    const auth = config.auth;
    if ((auth.type === "env" || auth.type === "bearer") && auth.tokenEnv) {
      const token = process.env[auth.tokenEnv];
      if (token) {
        env[auth.tokenEnv] = token;
      }
    }

    // Pass explicitly listed env vars (allowlist per server)
    if (config.envPassthrough) {
      for (const varName of config.envPassthrough) {
        const value = process.env[varName];
        if (value !== undefined) {
          env[varName] = value;
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
