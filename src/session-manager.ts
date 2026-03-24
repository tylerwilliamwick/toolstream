// src/session-manager.ts - Per-session state management

import { randomUUID } from "node:crypto";
import type { ToolStreamDatabase } from "./database.js";
import type { SessionState, ToolRecord, ScoredTool } from "./types.js";
import { META_TOOL_SCHEMAS } from "./meta-tools.js";

const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private db: ToolStreamDatabase;
  private sessionTimeoutMs: number;
  private maxContextBuffer: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    db: ToolStreamDatabase,
    sessionTimeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
    maxContextBuffer: number = 6
  ) {
    this.db = db;
    this.sessionTimeoutMs = sessionTimeoutMs;
    this.maxContextBuffer = maxContextBuffer;
  }

  startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.expireSessions();
    }, 60_000);
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  createSession(clientInfo?: string): SessionState {
    const id = randomUUID();
    const now = Date.now();
    const session: SessionState = {
      id,
      activeSurface: new Map(),
      contextBuffer: [],
      createdAt: now,
      lastActiveAt: now,
    };
    this.sessions.set(id, session);
    this.db.insertSession(id, clientInfo);
    return session;
  }

  getSession(id: string): SessionState | undefined {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActiveAt = Date.now();
      this.db.touchSession(id);
    }
    return session;
  }

  updateContext(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.contextBuffer.push(text);
    // Cap buffer size, drop oldest entries
    while (session.contextBuffer.length > this.maxContextBuffer) {
      session.contextBuffer.shift();
    }
    session.lastActiveAt = Date.now();
    this.db.touchSession(sessionId);
  }

  surfaceTools(sessionId: string, scoredTools: ScoredTool[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const st of scoredTools) {
      session.activeSurface.set(st.tool.id, st.tool);
      try {
        this.db.insertToolCache(sessionId, st.tool.id, st.score, st.source);
      } catch {
        // FK constraint fails when tool isn't in tools table yet; in-memory surface is authoritative
      }
    }
    session.lastActiveAt = Date.now();
  }

  surfaceToolsDirect(sessionId: string, tools: ToolRecord[], source: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const tool of tools) {
      session.activeSurface.set(tool.id, tool);
      try {
        this.db.insertToolCache(sessionId, tool.id, 1.0, source);
      } catch {
        // FK constraint fails when tool isn't in tools table yet; in-memory surface is authoritative
      }
    }
    session.lastActiveAt = Date.now();
  }

  getVisibleTools(
    sessionId: string
  ): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    const session = this.sessions.get(sessionId);
    const tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }> = [];

    // Always include meta-tools
    for (const mt of META_TOOL_SCHEMAS) {
      tools.push({
        name: mt.name,
        description: mt.description,
        inputSchema: mt.inputSchema as Record<string, unknown>,
      });
    }

    // Add surfaced tools with namespaced names
    if (session) {
      for (const [, tool] of session.activeSurface) {
        tools.push({
          name: `${tool.serverId}_${tool.toolName}`,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }

    return tools;
  }

  resolveToolCall(
    sessionId: string,
    toolName: string
  ): { serverId: string; originalName: string } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check if it's a namespaced tool in the active surface
    for (const [, tool] of session.activeSurface) {
      const namespacedName = `${tool.serverId}_${tool.toolName}`;
      if (namespacedName === toolName) {
        return { serverId: tool.serverId, originalName: tool.toolName };
      }
    }
    return null;
  }

  private expireSessions(): void {
    const cutoff = Date.now() - this.sessionTimeoutMs;
    const expired: string[] = [];

    for (const [id, session] of this.sessions) {
      if (session.lastActiveAt < cutoff) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      this.sessions.delete(id);
    }

    if (expired.length > 0) {
      this.db.deleteExpiredSessions(this.sessionTimeoutMs);
      console.log(`[SessionManager] Expired ${expired.length} sessions`);
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
}
