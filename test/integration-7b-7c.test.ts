import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolStreamDatabase } from "../src/database.js";
import { SessionManager } from "../src/session-manager.js";
import { SemanticRouter } from "../src/semantic-router.js";
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

describe("Integration: 7b + 7c combined behavior", () => {
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

  it("pre-loaded tools and session bias run simultaneously", () => {
    // Seed analytics for pre-loading
    db.recordToolCall("jira:search", "s0", 1);
    db.recordToolCall("jira:search", "s0", 2);
    db.recordToolCall("jira:create", "s0", 3);
    db.recordToolCall("gh:pr", "s0", 4);

    const tools: Record<string, ToolRecord> = {
      "jira:search": makeToolRecord("jira:search", "jira", "search"),
      "jira:create": makeToolRecord("jira:create", "jira", "create"),
      "gh:pr": makeToolRecord("gh:pr", "gh", "pr"),
    };

    const registry = {
      getToolById(id: string) { return tools[id] ?? null; },
    };

    const sm = new SessionManager(db, 300_000, 6, db, registry, 3);
    const session = sm.createSession();

    // 7b: Pre-loaded tools should be in the surface
    expect(session.activeSurface.size).toBe(3);
    expect(session.activeSurface.has("jira:search")).toBe(true);

    // 7c: Now build session context via server calls
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "gh");

    const ctx = sm.getSessionContext(session.id);
    expect(ctx).not.toBeNull();
    expect(ctx!.dominantServerId).toBe("jira");
    expect(ctx!.confidence).toBe(0.75); // 3/4
  });

  it("session surface stays bounded after multiple surfacing operations", () => {
    const tools: Record<string, ToolRecord> = {};
    // Create 20 tools
    for (let i = 0; i < 20; i++) {
      const id = `srv:tool_${i}`;
      tools[id] = makeToolRecord(id, "srv", `tool_${i}`);
      db.recordToolCall(id, "s0", i + 1);
    }

    const registry = {
      getToolById(id: string) { return tools[id] ?? null; },
    };

    // Pre-load 3
    const sm = new SessionManager(db, 300_000, 6, db, registry, 3);
    const session = sm.createSession();

    expect(session.activeSurface.size).toBe(3);

    // Surface more tools manually
    const moreScoredTools = Object.values(tools).slice(3, 10).map((t) => ({
      tool: t,
      score: 0.8,
      source: "semantic" as const,
    }));
    sm.surfaceTools(session.id, moreScoredTools);

    // Surface should contain all pre-loaded + manually surfaced
    expect(session.activeSurface.size).toBe(10);

    // Verify visible tools includes meta-tools + surfaced
    const visible = sm.getVisibleTools(session.id);
    // 4 meta-tools + 10 surfaced
    expect(visible.length).toBe(14);
  });

  it("session topic resets do not affect pre-loaded tools", () => {
    db.recordToolCall("jira:search", "s0", 1);

    const tools: Record<string, ToolRecord> = {
      "jira:search": makeToolRecord("jira:search", "jira", "search"),
    };

    const registry = {
      getToolById(id: string) { return tools[id] ?? null; },
    };

    const sm = new SessionManager(db, 300_000, 6, db, registry, 1);
    const session = sm.createSession();

    // Pre-loaded tool in surface
    expect(session.activeSurface.has("jira:search")).toBe(true);

    // Build and then reset session topic
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "jira");
    sm.recordServerCall(session.id, "gh");
    sm.recordServerCall(session.id, "gh");
    sm.recordServerCall(session.id, "gh"); // triggers reset

    // Pre-loaded tool should still be in surface (topic reset only clears call counts)
    expect(session.activeSurface.has("jira:search")).toBe(true);
  });
});
