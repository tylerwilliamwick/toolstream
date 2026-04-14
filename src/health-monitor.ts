// src/health-monitor.ts - Periodic health check via MCP ping

import type { UpstreamManager } from "./upstream-manager.js";
import { logger } from "./logger.js";

export interface HealthMonitorOptions {
  intervalMs?: number; // Default 60000 (60s)
  timeoutMs?: number;  // Default 10000 (10s) - for test injection
}

export class HealthMonitor {
  private upstreamManager: UpstreamManager;
  private db: any; // ToolStreamDatabase type
  private intervalMs: number;
  private timeoutMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private eventListeners: Map<string, Array<(...args: any[]) => void>> = new Map();

  constructor(upstreamManager: UpstreamManager, db: any, options: HealthMonitorOptions = {}) {
    this.upstreamManager = upstreamManager;
    this.db = db;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  start(): void {
    this.interval = setInterval(() => {
      this.pingAll();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  on(event: string, callback: (...args: any[]) => void): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.push(callback);
    this.eventListeners.set(event, listeners);
  }

  private emit(event: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(event) || [];
    for (const cb of listeners) {
      try { cb(...args); } catch { /* don't let listener errors break monitor */ }
    }
  }

  async pingAll(): Promise<void> {
    const servers = this.upstreamManager.getServerStatus();

    for (const server of servers) {
      await this.pingServer(server.id);
    }
  }

  private async pingServer(serverId: string): Promise<void> {
    const conn = this.upstreamManager.getConnection(serverId);
    if (!conn) return;

    const startTime = Date.now();

    try {
      // Ping with timeout
      await Promise.race([
        conn.client.ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Ping timeout')), this.timeoutMs)
        ),
      ]);

      const pingMs = Date.now() - startTime;

      // Record ping in DB if the method exists
      if (this.db.updateServerPing) {
        this.db.updateServerPing(serverId, pingMs);
      }

      // If server was previously unhealthy and ping succeeded, it recovered
      if (!conn.healthy && !conn.reconnecting) {
        conn.healthy = true;
        this.emit('server_recovered', serverId, pingMs);
        logger.info(`[HealthMonitor] Server '${serverId}' recovered (ping: ${pingMs}ms)`);
      }

      this.emit('ping_success', serverId, pingMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[HealthMonitor] Ping failed for '${serverId}': ${message}`);

      // Only trigger reconnect if not already reconnecting
      if (!conn.reconnecting) {
        conn.healthy = false;
        this.emit('server_down', serverId, message);
        this.upstreamManager.scheduleReconnect(serverId);
      }

      this.emit('ping_failed', serverId, message);
    }
  }
}
