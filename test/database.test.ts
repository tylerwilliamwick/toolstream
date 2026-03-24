import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolStreamDatabase } from "../src/database.js";
import Database from "better-sqlite3";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDbPath(): string {
  const dir = join(tmpdir(), "toolstream-test");
  mkdirSync(dir, { recursive: true });
  return join(dir, `test-${randomUUID()}.db`);
}

describe("ToolStreamDatabase", () => {
  let db: ToolStreamDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new ToolStreamDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    // Clean up WAL files
    for (const suffix of ["-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  describe("schema migrations", () => {
    it("creates all tables on first run", () => {
      const tables = db.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all()
        .map((r: any) => r.name);

      expect(tables).toContain("tools");
      expect(tables).toContain("embeddings");
      expect(tables).toContain("sessions");
      expect(tables).toContain("tool_cache");
      expect(tables).toContain("servers");
      expect(tables).toContain("schema_migrations");
    });

    it("records migration version", () => {
      const rows = db.raw
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all() as any[];
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0].version).toBe(1);
      expect(rows[1].version).toBe(2);
    });

    it("applies v2 migration to a v1-only database", () => {
      db.close();

      // Build a v1-only database by hand
      const v1Path = tmpDbPath();
      const rawDb = new Database(v1Path);
      rawDb.pragma("journal_mode = WAL");
      rawDb.exec(`
        CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        CREATE TABLE servers (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          transport_type TEXT NOT NULL,
          last_synced_at INTEGER,
          tool_count INTEGER NOT NULL DEFAULT 0
        );
      `);
      rawDb.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(Date.now());
      rawDb.close();

      // Opening through ToolStreamDatabase should apply v2
      const upgraded = new ToolStreamDatabase(v1Path);

      const cols = upgraded.raw
        .prepare("PRAGMA table_info(servers)")
        .all() as Array<{ name: string }>;
      const colNames = cols.map((c) => c.name);

      expect(colNames).toContain("last_ping_ms");
      expect(colNames).toContain("last_ping_at");

      upgraded.close();
      for (const suffix of ["", "-wal", "-shm"]) {
        const p = v1Path + suffix;
        if (existsSync(p)) unlinkSync(p);
      }

      // Re-open original db for afterEach cleanup
      db = new ToolStreamDatabase(dbPath);
    });

    it("enables WAL mode", () => {
      const result = db.raw.pragma("journal_mode") as any[];
      expect(result[0].journal_mode).toBe("wal");
    });
  });

  describe("server operations", () => {
    it("inserts and retrieves servers", () => {
      db.insertServer("github", "GitHub", "stdio");
      db.insertServer("postgres", "Postgres", "http");

      const servers = db.getAllServers();
      expect(servers).toHaveLength(2);
      expect(servers[0].id).toBe("github");
      expect(servers[1].id).toBe("postgres");
    });

    it("updates server sync", () => {
      db.insertServer("github", "GitHub", "stdio");
      db.updateServerSync("github", 42);

      const servers = db.getAllServers();
      expect(servers[0].tool_count).toBe(42);
      expect(servers[0].last_synced_at).toBeGreaterThan(0);
    });

    it("updateServerPing and getServerPing round-trip", () => {
      db.insertServer("github", "GitHub", "stdio");

      const before = db.getServerPing("github");
      expect(before).toBeDefined();
      expect(before!.last_ping_ms).toBeNull();
      expect(before!.last_ping_at).toBeNull();

      db.updateServerPing("github", 123);

      const after = db.getServerPing("github");
      expect(after).toBeDefined();
      expect(after!.last_ping_ms).toBe(123);
      expect(typeof after!.last_ping_at).toBe("string");
      expect(after!.last_ping_at!.length).toBeGreaterThan(0);
    });

    it("getServerPing returns undefined for missing server", () => {
      const result = db.getServerPing("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  describe("tool operations", () => {
    it("inserts and retrieves tool by id", () => {
      db.insertServer("fs", "Filesystem", "stdio");
      db.insertTool(
        "fs:read_file",
        "fs",
        "read_file",
        "Read a file",
        '{"type":"object"}'
      );

      const tool = db.getToolById("fs:read_file");
      expect(tool).toBeDefined();
      expect(tool!.tool_name).toBe("read_file");
      expect(tool!.description).toBe("Read a file");
      expect(tool!.is_active).toBe(1);
    });

    it("retrieves tools by server id", () => {
      db.insertServer("fs", "Filesystem", "stdio");
      db.insertTool("fs:read", "fs", "read", "Read", '{}');
      db.insertTool("fs:write", "fs", "write", "Write", '{}');

      const tools = db.getToolsByServerId("fs");
      expect(tools).toHaveLength(2);
    });

    it("deactivates server tools", () => {
      db.insertServer("fs", "Filesystem", "stdio");
      db.insertTool("fs:read", "fs", "read", "Read", '{}');

      db.deactivateServerTools("fs");

      const tool = db.getToolById("fs:read");
      expect(tool!.is_active).toBe(0);

      const active = db.getToolsByServerId("fs");
      expect(active).toHaveLength(0);
    });

    it("returns all active tools", () => {
      db.insertServer("fs", "Filesystem", "stdio");
      db.insertTool("fs:read", "fs", "read", "Read", '{}');
      db.insertTool("fs:write", "fs", "write", "Write", '{}');
      db.deactivateServerTools("fs");
      db.insertTool("fs:list", "fs", "list", "List", '{}');

      const active = db.getAllActiveTools();
      expect(active).toHaveLength(1);
      expect(active[0].tool_name).toBe("list");
    });
  });

  describe("session operations", () => {
    it("inserts and touches sessions", () => {
      db.insertSession("s1", "test-client");
      db.touchSession("s1");

      // No throw = success
    });

    it("deletes expired sessions", () => {
      db.insertSession("s1");
      // Manually set old timestamp
      db.raw
        .prepare("UPDATE sessions SET last_active_at = ? WHERE id = ?")
        .run(Date.now() - 600000, "s1");

      const deleted = db.deleteExpiredSessions(300000); // 5 min
      expect(deleted).toBe(1);
    });
  });

  describe("corrupt database handling", () => {
    it("renames corrupt db and creates fresh one", () => {
      db.close();

      // Write garbage to the db file
      const { writeFileSync } = require("node:fs");
      writeFileSync(dbPath, "this is not a database");

      // Should recover
      const db2 = new ToolStreamDatabase(dbPath);
      const tables = db2.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table'"
        )
        .all();
      expect(tables.length).toBeGreaterThan(0);
      db2.close();
    });
  });
});
