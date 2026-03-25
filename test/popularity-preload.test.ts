import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolStreamDatabase } from "../src/database.js";
import { SessionManager } from "../src/session-manager.js";
import type { ToolRecord } from "../src/types.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDbPath(): string {
  const dir = join(tmpdir(), "toolstream-test");
  mkdirSync(dir, { recursive: true });
  return join(dir, `test-${randomUUID()}.db`);
}

function makeToolRecord(id: string, serverId: string, toolName: string): ToolRecord {
  return {
    id,
    serverId,
    toolName,
    description: `${toolName} description`,
    inputSchema: { type: "object", properties: {} },
    isActive: true,
  };
}

describe("Popularity Pre-loading (7b)", () => {
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

  it("session start with analytics data surfaces top-3 tools", () => {
    // Seed analytics
    db.recordToolCall("fs:read_file", "s0", 1);
    db.recordToolCall("fs:read_file", "s0", 2);
    db.recordToolCall("fs:read_file", "s0", 3);
    db.recordToolCall("gh:create_issue", "s0", 4);
    db.recordToolCall("gh:create_issue", "s0", 5);
    db.recordToolCall("ob:search_notes", "s0", 6);

    const tools: Record<string, ToolRecord> = {
      "fs:read_file": makeToolRecord("fs:read_file", "fs", "read_file"),
      "gh:create_issue": makeToolRecord("gh:create_issue", "gh", "create_issue"),
      "ob:search_notes": makeToolRecord("ob:search_notes", "ob", "search_notes"),
    };

    const registry = {
      getToolById(id: string) { return tools[id] ?? null; },
    };

    const sm = new SessionManager(db, 300_000, 6, db, registry, 3);
    const session = sm.createSession();

    expect(session.activeSurface.size).toBe(3);
    expect(session.activeSurface.has("fs:read_file")).toBe(true);
    expect(session.activeSurface.has("gh:create_issue")).toBe(true);
    expect(session.activeSurface.has("ob:search_notes")).toBe(true);
  });

  it("session start without analytics data surfaces zero extra tools", () => {
    const registry = {
      getToolById() { return null; },
    };

    const sm = new SessionManager(db, 300_000, 6, db, registry, 3);
    const session = sm.createSession();

    expect(session.activeSurface.size).toBe(0);
  });

  it("offline server's tools are skipped gracefully", () => {
    db.recordToolCall("offline:some_tool", "s0", 1);
    db.recordToolCall("fs:read_file", "s0", 2);

    const tools: Record<string, ToolRecord> = {
      "fs:read_file": makeToolRecord("fs:read_file", "fs", "read_file"),
      // offline:some_tool not in registry = offline/removed
    };

    const registry = {
      getToolById(id: string) { return tools[id] ?? null; },
    };

    const sm = new SessionManager(db, 300_000, 6, db, registry, 3);
    const session = sm.createSession();

    expect(session.activeSurface.size).toBe(1);
    expect(session.activeSurface.has("fs:read_file")).toBe(true);
  });

  it("respects popularityPreloadCount config", () => {
    db.recordToolCall("a:t1", "s0", 1);
    db.recordToolCall("b:t2", "s0", 2);
    db.recordToolCall("c:t3", "s0", 3);

    const tools: Record<string, ToolRecord> = {
      "a:t1": makeToolRecord("a:t1", "a", "t1"),
      "b:t2": makeToolRecord("b:t2", "b", "t2"),
      "c:t3": makeToolRecord("c:t3", "c", "t3"),
    };

    const registry = {
      getToolById(id: string) { return tools[id] ?? null; },
    };

    // Only preload 1
    const sm = new SessionManager(db, 300_000, 6, db, registry, 1);
    const session = sm.createSession();

    expect(session.activeSurface.size).toBe(1);
  });

  it("no analytics store means no pre-loading", () => {
    const sm = new SessionManager(db, 300_000, 6);
    const session = sm.createSession();

    expect(session.activeSurface.size).toBe(0);
  });
});
