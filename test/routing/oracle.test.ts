import { describe, it, expect } from "vitest";
import { ToolStreamDatabase } from "../../src/database.js";
import { Oracle } from "../../src/routing/oracle.js";

describe("Oracle.evalRolling7d", () => {
  it("returns 1.0 precision when every surfaced tool gets called", () => {
    const db = new ToolStreamDatabase(":memory:");
    const now = Date.now();

    db.insertRouteTrace({
      sessionId: "sA",
      ts: now,
      queryText: "read",
      contextWindow: "read",
      strategyId: "baseline",
      candidatesJson: "[]",
      surfacedToolIds: "fs:read_file,gh:create_issue",
      belowThreshold: 0,
      latencyMs: 1,
    });
    db.recordToolCall("fs:read_file", "sA", 1);
    db.recordToolCall("gh:create_issue", "sA", 2);

    const oracle = new Oracle(db, { implicitWindowTurns: 3, curatedPrecisionGate: 0.80 });
    const metric = oracle.evalRolling7d("baseline");
    expect(metric.precision).toBe(1.0);
    expect(metric.hits).toBe(2);
    expect(metric.misses).toBe(0);
    db.close();
  });

  it("returns 0.5 precision when half of surfaced tools get called", () => {
    const db = new ToolStreamDatabase(":memory:");
    const now = Date.now();

    db.insertRouteTrace({
      sessionId: "sB",
      ts: now,
      queryText: "read",
      contextWindow: "read",
      strategyId: "baseline",
      candidatesJson: "[]",
      surfacedToolIds: "fs:read_file,gh:create_issue",
      belowThreshold: 0,
      latencyMs: 1,
    });
    db.recordToolCall("fs:read_file", "sB", 1);
    // gh:create_issue NOT called

    const oracle = new Oracle(db, { implicitWindowTurns: 3, curatedPrecisionGate: 0.80 });
    const metric = oracle.evalRolling7d("baseline");
    expect(metric.precision).toBe(0.5);
    expect(metric.hits).toBe(1);
    expect(metric.misses).toBe(1);
    db.close();
  });

  it("returns 0 precision with totalSurfaced=0 when no traces exist", () => {
    const db = new ToolStreamDatabase(":memory:");
    const oracle = new Oracle(db, { implicitWindowTurns: 3, curatedPrecisionGate: 0.80 });
    const metric = oracle.evalRolling7d("baseline");
    expect(metric.precision).toBe(0);
    expect(metric.hits).toBe(0);
    expect(metric.misses).toBe(0);
    expect(metric.totalSurfaced ?? 0).toBe(0);
    db.close();
  });

  it("ignores traces outside the 7-day window", () => {
    const db = new ToolStreamDatabase(":memory:");
    const oldTs = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago

    db.insertRouteTrace({
      sessionId: "sC",
      ts: oldTs,
      queryText: "old query",
      contextWindow: "old query",
      strategyId: "baseline",
      candidatesJson: "[]",
      surfacedToolIds: "fs:read_file",
      belowThreshold: 0,
      latencyMs: 1,
    });
    db.recordToolCall("fs:read_file", "sC", 1);

    const oracle = new Oracle(db, { implicitWindowTurns: 3, curatedPrecisionGate: 0.80 });
    const metric = oracle.evalRolling7d("baseline");
    expect(metric.hits + metric.misses).toBe(0);
    db.close();
  });
});
