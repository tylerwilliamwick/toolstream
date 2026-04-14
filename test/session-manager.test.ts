import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../src/session-manager.js";
import { ToolStreamDatabase } from "../src/database.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ToolRecord } from "../src/types.js";

function tmpDbPath(): string {
  const dir = join(tmpdir(), "toolstream-test");
  mkdirSync(dir, { recursive: true });
  return join(dir, `session-${randomUUID()}.db`);
}

function makeTool(serverId: string, name: string): ToolRecord {
  return {
    id: `${serverId}:${name}`,
    serverId,
    toolName: name,
    description: `${name} tool`,
    inputSchema: { type: "object" },
    isActive: true,
  };
}

describe("SessionManager", () => {
  let db: ToolStreamDatabase;
  let manager: SessionManager;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new ToolStreamDatabase(dbPath);
    manager = new SessionManager(db, 5000); // 5 second timeout for tests
  });

  afterEach(() => {
    manager.stopCleanup();
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it("creates session with unique id", () => {
    const s1 = manager.createSession();
    const s2 = manager.createSession();

    expect(s1.id).toBeTruthy();
    expect(s2.id).toBeTruthy();
    expect(s1.id).not.toBe(s2.id);
  });

  it("new session has empty surface and buffer", () => {
    const session = manager.createSession();
    expect(session.activeSurface.size).toBe(0);
    expect(session.contextBuffer).toHaveLength(0);
  });

  it("getSession returns session and updates timestamp", () => {
    const session = manager.createSession();
    const before = session.lastActiveAt;

    // Small delay
    const retrieved = manager.getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.lastActiveAt).toBeGreaterThanOrEqual(before);
  });

  it("getSession returns undefined for unknown id", () => {
    expect(manager.getSession("nonexistent")).toBeUndefined();
  });

  it("updateContext appends to buffer", () => {
    const session = manager.createSession();
    manager.updateContext(session.id, "first message");
    manager.updateContext(session.id, "second message");

    expect(session.contextBuffer).toHaveLength(2);
    expect(session.contextBuffer[0]).toBe("first message");
  });

  it("surfaceTools adds tools to active surface", () => {
    const session = manager.createSession();
    const tool = makeTool("fs", "read_file");

    manager.surfaceTools(session.id, [
      { tool, score: 0.9, source: "semantic" },
    ]);

    expect(session.activeSurface.size).toBe(1);
    expect(session.activeSurface.has("fs:read_file")).toBe(true);
  });

  it("getVisibleTools returns meta-tools plus surfaced tools", () => {
    const session = manager.createSession();
    const tool = makeTool("github", "create_issue");

    manager.surfaceToolsDirect(session.id, [tool], "meta_tool");

    const visible = manager.getVisibleTools(session.id);
    const names = visible.map((t) => t.name);

    // 4 meta-tools + 1 surfaced
    expect(names).toContain("discover_servers");
    expect(names).toContain("discover_tools");
    expect(names).toContain("execute_tool");
    expect(names).toContain("reconnect_server");
    expect(names).toContain("github_create_issue");
    expect(visible).toHaveLength(5);
  });

  it("resolveToolCall resolves namespaced tool", () => {
    const session = manager.createSession();
    const tool = makeTool("github", "create_issue");
    manager.surfaceToolsDirect(session.id, [tool], "meta_tool");

    const resolved = manager.resolveToolCall(
      session.id,
      "github_create_issue"
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.serverId).toBe("github");
    expect(resolved!.originalName).toBe("create_issue");
  });

  it("resolveToolCall returns null for unknown tool", () => {
    const session = manager.createSession();
    const resolved = manager.resolveToolCall(session.id, "nonexistent");
    expect(resolved).toBeNull();
  });

  it("tracks session count", () => {
    expect(manager.sessionCount).toBe(0);
    manager.createSession();
    expect(manager.sessionCount).toBe(1);
    manager.createSession();
    expect(manager.sessionCount).toBe(2);
  });

  // --- session expiry ---

  it("expireSessions() removes sessions past timeout", () => {
    const session = manager.createSession();
    expect(manager.getSession(session.id)).toBeDefined();

    // Backdate lastActiveAt beyond the 5s timeout
    session.lastActiveAt = Date.now() - 10_000;

    (manager as any).expireSessions();

    expect(manager.getSession(session.id)).toBeUndefined();
    expect(manager.sessionCount).toBe(0);
  });

  // --- cold-start with empty analytics ---

  it("createSession() succeeds with analytics store enabled but no events (cold start)", () => {
    // Pass analyticsStore (db) and preloadCount=3, but DB has no events yet
    const coldStart = new SessionManager(db, 5000, undefined, db, undefined, 3);
    const session = coldStart.createSession();
    expect(session.id).toBeTruthy();
    expect(session.activeSurface.size).toBe(0);
    coldStart.stopCleanup();
  });

  describe("context buffer cap", () => {
    it("caps buffer at maxContextBuffer after 100 updates", () => {
      const capped = new SessionManager(db, 5000, 6);
      const session = capped.createSession();
      for (let i = 0; i < 100; i++) {
        capped.updateContext(session.id, `message ${i}`);
      }
      expect(session.contextBuffer).toHaveLength(6);
    });

    it("keeps newest entries and drops oldest", () => {
      const capped = new SessionManager(db, 5000, 3);
      const session = capped.createSession();
      for (let i = 0; i < 5; i++) {
        capped.updateContext(session.id, `message ${i}`);
      }
      expect(session.contextBuffer).toEqual(["message 2", "message 3", "message 4"]);
    });

    it("default maxContextBuffer is 6", () => {
      const defaultManager = new SessionManager(db, 5000);
      const session = defaultManager.createSession();
      for (let i = 0; i < 10; i++) {
        defaultManager.updateContext(session.id, `message ${i}`);
      }
      expect(session.contextBuffer).toHaveLength(6);
    });
  });
});
