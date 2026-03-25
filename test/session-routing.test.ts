import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolStreamDatabase } from "../src/database.js";
import { SessionManager } from "../src/session-manager.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpDbPath(): string {
  const dir = join(tmpdir(), "toolstream-test");
  mkdirSync(dir, { recursive: true });
  return join(dir, `test-${randomUUID()}.db`);
}

describe("Session-Level Multi-Turn Routing (7c)", () => {
  let db: ToolStreamDatabase;
  let dbPath: string;
  let sm: SessionManager;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new ToolStreamDatabase(dbPath);
    sm = new SessionManager(db, 300_000, 6);
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    for (const suffix of ["-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it("returns null when fewer than 3 calls", () => {
    const session = sm.createSession();
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "jira");

    const ctx = sm.getSessionContext(session.id);
    expect(ctx).toBeNull();
  });

  it("after 5 Jira calls, returns Jira as dominant with correct confidence", () => {
    const session = sm.createSession();
    // Interleave to avoid triggering the 3-consecutive reset
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "github");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "github");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "github");
    sm.recordServerCall(session.id, "jira");

    const ctx = sm.getSessionContext(session.id);
    expect(ctx).not.toBeNull();
    expect(ctx!.dominantServerId).toBe("jira");
    expect(ctx!.confidence).toBeCloseTo(5 / 8, 3);
  });

  it("resets after 3 consecutive non-dominant calls", () => {
    const session = sm.createSession();

    // Build up Jira dominance
    for (let i = 0; i < 5; i++) {
      sm.recordServerCall(session.id, "jira");
    }

    // 3 consecutive non-Jira calls trigger reset
    sm.recordServerCall(session.id, "github");
    sm.recordServerCall(session.id, "github");
    sm.recordServerCall(session.id, "github");

    // After reset, only the last github call remains
    const ctx = sm.getSessionContext(session.id);
    // Should be null or github-only with too few calls
    // After reset: counts cleared, then github:1 added
    // 1 call < 3 minimum, so null
    expect(ctx).toBeNull();
  });

  it("4 Jira calls then 3 elsewhere: bias never activates below threshold", () => {
    const session = sm.createSession();

    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "jira");
    // Now 3 consecutive non-dominant
    sm.recordServerCall(session.id, "github");
    sm.recordServerCall(session.id, "github");
    sm.recordServerCall(session.id, "github");

    // Reset happened, only github:1
    const ctx = sm.getSessionContext(session.id);
    expect(ctx).toBeNull();
  });

  it("confidence calculation is correct (5/8 = 0.625)", () => {
    const session = sm.createSession();

    // 5 Jira, 3 GitHub (interleaved so no reset)
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "github");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "github");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "github");
    sm.recordServerCall(session.id, "jira");

    const ctx = sm.getSessionContext(session.id);
    expect(ctx).not.toBeNull();
    expect(ctx!.dominantServerId).toBe("jira");
    expect(ctx!.confidence).toBeCloseTo(0.625, 3);
  });

  it("returns null for unknown session", () => {
    const ctx = sm.getSessionContext("nonexistent");
    expect(ctx).toBeNull();
  });
});
