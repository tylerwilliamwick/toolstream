// src/session-manager.ts - Per-session state management

import { randomUUID } from "node:crypto";
import type { ToolStreamDatabase } from "./database.js";
import type { SessionState, ToolRecord, ScoredTool, SessionTopicContext } from "./types.js";
import { META_TOOL_SCHEMAS } from "./meta-tools.js";
import { logger } from "./logger.js";

const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private db: ToolStreamDatabase;
  private analyticsStore: ToolStreamDatabase | null;
  private registry: { getToolById(id: string): ToolRecord | null | undefined } | null;
  private popularityPreloadCount: number;
  private sessionTimeoutMs: number;
  private maxContextBuffer: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    db: ToolStreamDatabase,
    sessionTimeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS,
    maxContextBuffer: number = 6,
    analyticsStore?: ToolStreamDatabase,
    registry?: { getToolById(id: string): ToolRecord | null | undefined },
    popularityPreloadCount: number = 3
  ) {
    this.db = db;
    this.analyticsStore = analyticsStore ?? null;
    this.registry = registry ?? null;
    this.popularityPreloadCount = popularityPreloadCount;
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
      serverCallCounts: new Map(),
      consecutiveNonDominantCalls: 0,
    };
    this.sessions.set(id, session);
    this.db.insertSession(id, clientInfo);

    // Pre-load popular tools from analytics
    if (this.analyticsStore && this.registry && this.popularityPreloadCount > 0) {
      try {
        const topTools = this.analyticsStore.getTopTools(this.popularityPreloadCount);
        for (const entry of topTools) {
          const tool = this.registry.getToolById(entry.tool_id);
          if (!tool) continue; // tool may have been removed
          if (!tool.isActive) continue; // skip inactive tools
          session.activeSurface.set(tool.id, tool);
          try {
            this.db.insertToolCache(id, tool.id, 1.0, "startup");
          } catch {
            // FK constraint; in-memory surface is authoritative
          }
        }
        if (topTools.length > 0) {
          logger.info(`[SessionManager] Pre-loaded ${session.activeSurface.size} popular tools`);
        }
      } catch (err) {
        logger.error(`[SessionManager] Popularity pre-load failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

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
        const namespacedName = `${tool.serverId}_${tool.toolName}`;
        // Check for collision with already-added tools
        const existing = tools.find(t => t.name === namespacedName);
        if (existing) {
          logger.warn(`[SessionManager] Tool name collision: '${namespacedName}' from server '${tool.serverId}' conflicts with existing tool`);
          continue; // skip duplicate
        }
        tools.push({
          name: namespacedName,
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

  recordServerCall(sessionId: string, serverId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const currentCount = session.serverCallCounts.get(serverId) ?? 0;
    session.serverCallCounts.set(serverId, currentCount + 1);

    // Track consecutive non-dominant calls for reset detection
    const dominant = this.getDominantServer(session);
    if (dominant && serverId !== dominant) {
      session.consecutiveNonDominantCalls++;
      if (session.consecutiveNonDominantCalls >= 3) {
        // Reset: topic has shifted
        session.serverCallCounts.clear();
        session.consecutiveNonDominantCalls = 0;
        session.serverCallCounts.set(serverId, 1);
      }
    } else {
      session.consecutiveNonDominantCalls = 0;
    }
  }

  getSessionContext(sessionId: string): SessionTopicContext | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    let totalCalls = 0;
    for (const count of session.serverCallCounts.values()) {
      totalCalls += count;
    }

    if (totalCalls < 3) return null; // not enough data

    const dominant = this.getDominantServer(session);
    if (!dominant) return null;

    const dominantCount = session.serverCallCounts.get(dominant) ?? 0;
    const confidence = dominantCount / totalCalls;

    return { dominantServerId: dominant, confidence };
  }

  private getDominantServer(session: SessionState): string | null {
    let maxCount = 0;
    let dominant: string | null = null;
    for (const [serverId, count] of session.serverCallCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominant = serverId;
      }
    }
    return dominant;
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
      logger.info(`[SessionManager] Expired ${expired.length} sessions`);
    }
  }

  invalidateServerTools(serverId: string): void {
    for (const [, session] of this.sessions) {
      for (const [toolId, tool] of session.activeSurface) {
        if (tool.serverId === serverId) {
          session.activeSurface.delete(toolId);
        }
      }
    }
    logger.info(`[SessionManager] Invalidated surface tools for server '${serverId}'`);
  }

  get sessionCount(): number {
    return this.sessions.size;
  }
}
