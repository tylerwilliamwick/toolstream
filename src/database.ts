// src/database.ts - SQLite storage layer with schema migrations

import Database from "better-sqlite3";
import { existsSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

const SCHEMA_VERSION = 4;

const MIGRATIONS: Record<number, string[]> = {
  1: [`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS servers (
      id             TEXT PRIMARY KEY,
      display_name   TEXT NOT NULL,
      transport_type TEXT NOT NULL,
      last_synced_at INTEGER,
      tool_count     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tools (
      id           TEXT PRIMARY KEY,
      server_id    TEXT NOT NULL,
      tool_name    TEXT NOT NULL,
      description  TEXT NOT NULL,
      input_schema TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      is_active    INTEGER NOT NULL DEFAULT 1,
      UNIQUE(server_id, tool_name)
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      tool_id    TEXT PRIMARY KEY REFERENCES tools(id) ON DELETE CASCADE,
      vector     BLOB NOT NULL,
      model_id   TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id             TEXT PRIMARY KEY,
      client_info    TEXT,
      created_at     INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      context_buffer TEXT
    );

    CREATE TABLE IF NOT EXISTS tool_cache (
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_id     TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
      score       REAL NOT NULL,
      surfaced_at INTEGER NOT NULL,
      source      TEXT NOT NULL,
      PRIMARY KEY (session_id, tool_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tools_server_id ON tools(server_id);
    CREATE INDEX IF NOT EXISTS idx_tool_cache_session ON tool_cache(session_id);
  `],
  2: [
    `ALTER TABLE servers ADD COLUMN last_ping_ms INTEGER`,
    `ALTER TABLE servers ADD COLUMN last_ping_at TEXT`,
  ],
  3: [
    `CREATE TABLE IF NOT EXISTS tool_call_events (
      tool_id            TEXT NOT NULL,
      session_id         TEXT NOT NULL,
      timestamp          INTEGER NOT NULL,
      sequence_position  INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tool_call_events_tool ON tool_call_events(tool_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tool_call_events_session ON tool_call_events(session_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tool_call_events_ts ON tool_call_events(timestamp)`,
    `CREATE TABLE IF NOT EXISTS tool_cooccurrence (
      tool_a_id    TEXT NOT NULL,
      tool_b_id    TEXT NOT NULL,
      count        INTEGER NOT NULL DEFAULT 0,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (tool_a_id, tool_b_id)
    )`,
  ],
  4: [
    `CREATE TABLE IF NOT EXISTS route_traces (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id         TEXT NOT NULL,
      ts                 INTEGER NOT NULL,
      query_text         TEXT NOT NULL,
      context_window     TEXT NOT NULL,
      strategy_id        TEXT NOT NULL,
      candidates_json    TEXT NOT NULL,
      surfaced_tool_ids  TEXT NOT NULL,
      below_threshold    INTEGER NOT NULL,
      latency_ms         INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_route_traces_session ON route_traces(session_id, ts)`,
    `CREATE INDEX IF NOT EXISTS idx_route_traces_ts ON route_traces(ts)`,
    `CREATE INDEX IF NOT EXISTS idx_route_traces_strategy ON route_traces(strategy_id, ts)`,
  ],
};

export class ToolStreamDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true });

    if (existsSync(dbPath)) {
      try {
        // Test if DB is valid
        const testDb = new Database(dbPath, { readonly: true });
        testDb.pragma("integrity_check");
        testDb.close();
      } catch {
        const corruptPath = `${dbPath}.corrupt.${Date.now()}`;
        console.warn(
          `[Database] Corrupt database detected, renaming to ${corruptPath}`
        );
        renameSync(dbPath, corruptPath);
      }
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.runMigrations();
  }

  private runMigrations(): void {
    // Ensure schema_migrations table exists first
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    const applied = new Set(
      this.db
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row: any) => row.version as number)
    );

    for (const [versionStr, statements] of Object.entries(MIGRATIONS)) {
      const version = Number(versionStr);
      if (!applied.has(version)) {
        for (const sql of statements) {
          this.db.exec(sql);
        }
        this.db
          .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(version, Date.now());
        console.log(`[Database] Applied migration v${version}`);
      }
    }
  }

  // --- Server operations ---

  insertServer(
    id: string,
    displayName: string,
    transportType: string
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO servers (id, display_name, transport_type, tool_count)
         VALUES (?, ?, ?, 0)`
      )
      .run(id, displayName, transportType);
  }

  getAllServers(): Array<{
    id: string;
    display_name: string;
    transport_type: string;
    last_synced_at: number | null;
    tool_count: number;
  }> {
    return this.db.prepare("SELECT * FROM servers").all() as any[];
  }

  updateServerSync(id: string, toolCount: number): void {
    this.db
      .prepare(
        "UPDATE servers SET last_synced_at = ?, tool_count = ? WHERE id = ?"
      )
      .run(Date.now(), toolCount, id);
  }

  updateServerPing(serverId: string, pingMs: number): void {
    this.db
      .prepare(
        "UPDATE servers SET last_ping_ms = ?, last_ping_at = datetime('now') WHERE id = ?"
      )
      .run(pingMs, serverId);
  }

  getServerPing(
    serverId: string
  ): { last_ping_ms: number | null; last_ping_at: string | null } | undefined {
    return this.db
      .prepare("SELECT last_ping_ms, last_ping_at FROM servers WHERE id = ?")
      .get(serverId) as any;
  }

  // --- Tool operations ---

  insertTool(
    id: string,
    serverId: string,
    toolName: string,
    description: string,
    inputSchema: string
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO tools (id, server_id, tool_name, description, input_schema, created_at, updated_at, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(id, serverId, toolName, description, inputSchema, now, now);
  }

  getToolById(
    id: string
  ): {
    id: string;
    server_id: string;
    tool_name: string;
    description: string;
    input_schema: string;
    is_active: number;
  } | undefined {
    return this.db.prepare("SELECT * FROM tools WHERE id = ?").get(id) as any;
  }

  getToolsByServerId(
    serverId: string
  ): Array<{
    id: string;
    server_id: string;
    tool_name: string;
    description: string;
    input_schema: string;
    is_active: number;
  }> {
    return this.db
      .prepare("SELECT * FROM tools WHERE server_id = ? AND is_active = 1")
      .all(serverId) as any[];
  }

  getAllActiveTools(): Array<{
    id: string;
    server_id: string;
    tool_name: string;
    description: string;
    input_schema: string;
  }> {
    return this.db
      .prepare("SELECT * FROM tools WHERE is_active = 1")
      .all() as any[];
  }

  deactivateServerTools(serverId: string): void {
    this.db
      .prepare("UPDATE tools SET is_active = 0, updated_at = ? WHERE server_id = ?")
      .run(Date.now(), serverId);
  }

  updateTool(id: string, description: string, inputSchema: string): void {
    this.db
      .prepare(
        "UPDATE tools SET description = ?, input_schema = ?, updated_at = ? WHERE id = ?"
      )
      .run(description, inputSchema, Date.now(), id);
  }

  // --- Embedding operations ---

  insertEmbedding(toolId: string, vector: Buffer, modelId: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO embeddings (tool_id, vector, model_id, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(toolId, vector, modelId, Date.now());
  }

  getEmbedding(
    toolId: string
  ): { tool_id: string; vector: Buffer; model_id: string } | undefined {
    return this.db
      .prepare("SELECT * FROM embeddings WHERE tool_id = ?")
      .get(toolId) as any;
  }

  getAllEmbeddings(): Array<{
    tool_id: string;
    vector: Buffer;
    model_id: string;
  }> {
    return this.db.prepare("SELECT * FROM embeddings").all() as any[];
  }

  // --- Session operations ---

  insertSession(id: string, clientInfo?: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, client_info, created_at, last_active_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(id, clientInfo ?? null, now, now);
  }

  touchSession(id: string): void {
    this.db
      .prepare("UPDATE sessions SET last_active_at = ? WHERE id = ?")
      .run(Date.now(), id);
  }

  deleteExpiredSessions(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db
      .prepare("DELETE FROM sessions WHERE last_active_at < ?")
      .run(cutoff);
    return result.changes;
  }

  // --- Tool cache operations ---

  insertToolCache(
    sessionId: string,
    toolId: string,
    score: number,
    source: string
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO tool_cache (session_id, tool_id, score, surfaced_at, source)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(sessionId, toolId, score, Date.now(), source);
  }

  getSessionToolCache(
    sessionId: string
  ): Array<{ tool_id: string; score: number; source: string }> {
    return this.db
      .prepare("SELECT tool_id, score, source FROM tool_cache WHERE session_id = ?")
      .all(sessionId) as any[];
  }

  // --- Analytics operations ---

  recordToolCall(toolId: string, sessionId: string, sequencePos: number): void {
    this.db
      .prepare(
        `INSERT INTO tool_call_events (tool_id, session_id, timestamp, sequence_position)
         VALUES (?, ?, ?, ?)`
      )
      .run(toolId, sessionId, Date.now(), sequencePos);
  }

  incrementCooccurrence(toolAId: string, toolBId: string): void {
    const now = Date.now();
    // Normalize order so (A,B) and (B,A) are the same pair
    const [first, second] = toolAId < toolBId ? [toolAId, toolBId] : [toolBId, toolAId];
    this.db
      .prepare(
        `INSERT INTO tool_cooccurrence (tool_a_id, tool_b_id, count, last_seen_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(tool_a_id, tool_b_id)
         DO UPDATE SET count = count + 1, last_seen_at = ?`
      )
      .run(first, second, now, now);
  }

  getTopTools(limit: number): Array<{ tool_id: string; call_count: number }> {
    return this.db
      .prepare(
        `SELECT tool_id, COUNT(*) as call_count
         FROM tool_call_events
         GROUP BY tool_id
         ORDER BY call_count DESC
         LIMIT ?`
      )
      .all(limit) as any[];
  }

  getTopCooccurrence(
    limit: number
  ): Array<{ tool_a_id: string; tool_b_id: string; count: number }> {
    return this.db
      .prepare(
        `SELECT tool_a_id, tool_b_id, count
         FROM tool_cooccurrence
         ORDER BY count DESC
         LIMIT ?`
      )
      .all(limit) as any[];
  }

  getCooccurring(
    toolId: string,
    limit: number
  ): Array<{ tool_id: string; count: number }> {
    return this.db
      .prepare(
        `SELECT
           CASE WHEN tool_a_id = ? THEN tool_b_id ELSE tool_a_id END as tool_id,
           count
         FROM tool_cooccurrence
         WHERE tool_a_id = ? OR tool_b_id = ?
         ORDER BY count DESC
         LIMIT ?`
      )
      .all(toolId, toolId, toolId, limit) as any[];
  }

  clearEmbeddings(): void {
    this.db.exec("DELETE FROM embeddings");
  }

  pruneOldEvents(ttlDays: number): number {
    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare("DELETE FROM tool_call_events WHERE timestamp < ?")
      .run(cutoff);
    return result.changes;
  }

  getSessionToolCalls(sessionId: string): Array<{ tool_id: string }> {
    return this.db
      .prepare("SELECT DISTINCT tool_id FROM tool_call_events WHERE session_id = ?")
      .all(sessionId) as any[];
  }

  // --- Route trace operations ---

  insertRouteTrace(trace: {
    sessionId: string;
    ts: number;
    queryText: string;
    contextWindow: string;
    strategyId: string;
    candidatesJson: string;
    surfacedToolIds: string;
    belowThreshold: 0 | 1;
    latencyMs: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO route_traces
         (session_id, ts, query_text, context_window, strategy_id,
          candidates_json, surfaced_tool_ids, below_threshold, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        trace.sessionId,
        trace.ts,
        trace.queryText,
        trace.contextWindow,
        trace.strategyId,
        trace.candidatesJson,
        trace.surfacedToolIds,
        trace.belowThreshold,
        trace.latencyMs
      );
  }

  getRouteTracesBySession(
    sessionId: string,
    limit: number
  ): Array<{
    id: number;
    session_id: string;
    ts: number;
    query_text: string;
    context_window: string;
    strategy_id: string;
    candidates_json: string;
    surfaced_tool_ids: string;
    below_threshold: number;
    latency_ms: number;
  }> {
    return this.db
      .prepare(
        `SELECT * FROM route_traces WHERE session_id = ? ORDER BY ts DESC LIMIT ?`
      )
      .all(sessionId, limit) as any[];
  }

  getRouteTracesByStrategy(
    strategyId: string,
    sinceMs: number
  ): Array<{
    id: number;
    session_id: string;
    ts: number;
    surfaced_tool_ids: string;
    strategy_id: string;
  }> {
    return this.db
      .prepare(
        `SELECT id, session_id, ts, surfaced_tool_ids, strategy_id
         FROM route_traces
         WHERE strategy_id = ? AND ts >= ?
         ORDER BY ts DESC`
      )
      .all(strategyId, sinceMs) as any[];
  }

  pruneRouteTraces(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare("DELETE FROM route_traces WHERE ts < ?")
      .run(cutoff);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  get raw(): Database.Database {
    return this.db;
  }
}
