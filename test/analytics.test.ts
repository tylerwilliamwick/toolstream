import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolStreamDatabase } from "../src/database.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDbPath(): string {
  const dir = join(tmpdir(), "toolstream-test");
  mkdirSync(dir, { recursive: true });
  return join(dir, `test-${randomUUID()}.db`);
}

describe("Usage Analytics (7a)", () => {
  let db: ToolStreamDatabase;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new ToolStreamDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    for (const suffix of ["-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  describe("schema migration v3", () => {
    it("creates tool_call_events and tool_cooccurrence tables", () => {
      const tables = db.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all()
        .map((r: any) => r.name);

      expect(tables).toContain("tool_call_events");
      expect(tables).toContain("tool_cooccurrence");
    });

    it("records migration version 3", () => {
      const rows = db.raw
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all() as any[];
      const versions = rows.map((r: any) => r.version);
      expect(versions).toContain(3);
    });
  });

  describe("recordToolCall", () => {
    it("persists tool call events", () => {
      db.recordToolCall("fs:read_file", "session-1", 1);
      db.recordToolCall("fs:write_file", "session-1", 2);
      db.recordToolCall("fs:read_file", "session-2", 1);

      const rows = db.raw
        .prepare("SELECT * FROM tool_call_events")
        .all() as any[];
      expect(rows).toHaveLength(3);
    });

    it("stores correct sequence position", () => {
      db.recordToolCall("fs:read_file", "session-1", 5);

      const row = db.raw
        .prepare("SELECT * FROM tool_call_events LIMIT 1")
        .get() as any;
      expect(row.sequence_position).toBe(5);
      expect(row.tool_id).toBe("fs:read_file");
      expect(row.session_id).toBe("session-1");
      expect(row.timestamp).toBeGreaterThan(0);
    });
  });

  describe("getTopTools", () => {
    it("returns tools ranked by call count", () => {
      db.recordToolCall("fs:read_file", "s1", 1);
      db.recordToolCall("fs:read_file", "s1", 2);
      db.recordToolCall("fs:read_file", "s2", 1);
      db.recordToolCall("gh:create_issue", "s1", 3);

      const top = db.getTopTools(10);
      expect(top).toHaveLength(2);
      expect(top[0].tool_id).toBe("fs:read_file");
      expect(top[0].call_count).toBe(3);
      expect(top[1].tool_id).toBe("gh:create_issue");
      expect(top[1].call_count).toBe(1);
    });

    it("respects limit", () => {
      db.recordToolCall("a", "s1", 1);
      db.recordToolCall("b", "s1", 2);
      db.recordToolCall("c", "s1", 3);

      const top = db.getTopTools(2);
      expect(top).toHaveLength(2);
    });

    it("returns empty array when no data", () => {
      const top = db.getTopTools(10);
      expect(top).toHaveLength(0);
    });
  });

  describe("co-occurrence", () => {
    it("increments co-occurrence counts correctly", () => {
      db.incrementCooccurrence("fs:read_file", "gh:create_issue");
      db.incrementCooccurrence("fs:read_file", "gh:create_issue");
      db.incrementCooccurrence("fs:read_file", "gh:create_issue");

      const pairs = db.getCooccurring("fs:read_file", 10);
      expect(pairs).toHaveLength(1);
      expect(pairs[0].tool_id).toBe("gh:create_issue");
      expect(pairs[0].count).toBe(3);
    });

    it("normalizes pair order (A,B) == (B,A)", () => {
      db.incrementCooccurrence("z:tool", "a:tool");
      db.incrementCooccurrence("a:tool", "z:tool");

      const rows = db.raw
        .prepare("SELECT * FROM tool_cooccurrence")
        .all() as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].count).toBe(2);
    });

    it("returns co-occurring tools for a given tool", () => {
      db.incrementCooccurrence("fs:read", "gh:issue");
      db.incrementCooccurrence("fs:read", "ob:note");
      db.incrementCooccurrence("fs:read", "ob:note");

      const pairs = db.getCooccurring("fs:read", 10);
      expect(pairs).toHaveLength(2);
      // ob:note has count 2, gh:issue has count 1
      expect(pairs[0].tool_id).toBe("ob:note");
      expect(pairs[0].count).toBe(2);
      expect(pairs[1].tool_id).toBe("gh:issue");
      expect(pairs[1].count).toBe(1);
    });

    it("returns empty array for unknown tool", () => {
      const pairs = db.getCooccurring("nonexistent", 10);
      expect(pairs).toHaveLength(0);
    });
  });

  describe("pruneOldEvents", () => {
    it("removes events older than TTL", () => {
      db.recordToolCall("fs:read", "s1", 1);

      // Manually backdate the event to 31 days ago
      const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
      db.raw
        .prepare("UPDATE tool_call_events SET timestamp = ?")
        .run(oldTimestamp);

      db.recordToolCall("fs:write", "s1", 2); // fresh event

      const pruned = db.pruneOldEvents(30);
      expect(pruned).toBe(1);

      const remaining = db.raw
        .prepare("SELECT * FROM tool_call_events")
        .all() as any[];
      expect(remaining).toHaveLength(1);
      expect(remaining[0].tool_id).toBe("fs:write");
    });

    it("returns 0 when nothing to prune", () => {
      db.recordToolCall("fs:read", "s1", 1);
      const pruned = db.pruneOldEvents(30);
      expect(pruned).toBe(0);
    });
  });

  describe("clearEmbeddings", () => {
    it("removes all embeddings", () => {
      db.insertServer("fs", "Filesystem", "stdio");
      db.insertTool("fs:read", "fs", "read", "Read", "{}");
      db.insertEmbedding("fs:read", Buffer.from([1, 2, 3]), "test-model");

      const before = db.getAllEmbeddings();
      expect(before).toHaveLength(1);

      db.clearEmbeddings();

      const after = db.getAllEmbeddings();
      expect(after).toHaveLength(0);
    });
  });

  describe("getSessionToolCalls", () => {
    it("returns distinct tools called in a session", () => {
      db.recordToolCall("fs:read", "s1", 1);
      db.recordToolCall("fs:read", "s1", 2); // duplicate
      db.recordToolCall("gh:issue", "s1", 3);
      db.recordToolCall("fs:write", "s2", 1); // different session

      const tools = db.getSessionToolCalls("s1");
      const toolIds = tools.map((t) => t.tool_id).sort();
      expect(toolIds).toEqual(["fs:read", "gh:issue"]);
    });
  });

  describe("analytics persists across restart", () => {
    it("retains data after close and reopen", () => {
      db.recordToolCall("fs:read", "s1", 1);
      db.incrementCooccurrence("fs:read", "gh:issue");
      db.close();

      const db2 = new ToolStreamDatabase(dbPath);
      const top = db2.getTopTools(10);
      expect(top).toHaveLength(1);
      expect(top[0].tool_id).toBe("fs:read");

      const pairs = db2.getCooccurring("fs:read", 10);
      expect(pairs).toHaveLength(1);
      db2.close();

      // Reopen for afterEach cleanup
      db = new ToolStreamDatabase(dbPath);
    });
  });
});
