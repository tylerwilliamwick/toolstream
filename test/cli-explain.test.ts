import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolStreamDatabase } from "../src/database.js";
import { explainCommand } from "../src/cli/explain.js";

describe("explainCommand", () => {
  const logs: string[] = [];
  let origLog: typeof console.log;

  beforeEach(() => {
    logs.length = 0;
    origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };
  });

  afterEach(() => {
    console.log = origLog;
  });

  it("prints trace details for a session that has traces", async () => {
    const db = new ToolStreamDatabase(":memory:");
    db.insertRouteTrace({
      sessionId: "sess-X",
      ts: Date.now(),
      queryText: "read a file",
      contextWindow: "read a file",
      strategyId: "baseline",
      candidatesJson: "[]",
      surfacedToolIds: "fs:read_file",
      belowThreshold: 0,
      latencyMs: 4,
    });

    await explainCommand({ sessionId: "sess-X", limit: 10, db });

    const combined = logs.join("\n");
    expect(combined).toContain("sess-X");
    expect(combined).toContain("baseline");
    expect(combined).toContain("fs:read_file");
    db.close();
  });

  it("prints a friendly message when no traces exist", async () => {
    const db = new ToolStreamDatabase(":memory:");
    await explainCommand({ sessionId: "missing", limit: 10, db });
    const combined = logs.join("\n");
    expect(combined).toMatch(/No traces/i);
    db.close();
  });
});
