import { describe, it, expect } from "vitest";
import { ToolStreamDatabase } from "../../src/database.js";
import { TraceStore } from "../../src/routing/trace-store.js";
import type { RouteTrace } from "../../src/routing/strategy.js";

function sampleTrace(overrides: Partial<RouteTrace> = {}): RouteTrace {
  return {
    sessionId: "s1",
    ts: Date.now(),
    queryText: "q",
    contextWindow: "ctx",
    strategyId: "baseline",
    candidates: [{ toolId: "fs:read_file", baseScore: 0.8, boosts: {}, finalScore: 0.8 }],
    surfacedToolIds: ["fs:read_file"],
    belowThreshold: false,
    latencyMs: 3,
    ...overrides,
  };
}

describe("TraceStore", () => {
  it("writes a trace asynchronously (non-blocking)", async () => {
    const db = new ToolStreamDatabase(":memory:");
    const store = new TraceStore(db, 14);

    store.write(sampleTrace({ sessionId: "s-async" }));

    // setImmediate deferral: row may not be visible synchronously
    await new Promise((resolve) => setImmediate(resolve));

    const rows = db.getRouteTracesBySession("s-async", 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].strategy_id).toBe("baseline");
    db.close();
  });

  it("adds <2ms event loop delay per write", async () => {
    const db = new ToolStreamDatabase(":memory:");
    const store = new TraceStore(db, 14);

    const start = performance.now();
    store.write(sampleTrace());
    const syncCost = performance.now() - start;

    expect(syncCost).toBeLessThan(2);
    db.close();
  });

  it("prune() deletes traces older than retention", async () => {
    const db = new ToolStreamDatabase(":memory:");
    const store = new TraceStore(db, 14);

    db.insertRouteTrace({
      sessionId: "s-old",
      ts: Date.now() - 20 * 24 * 60 * 60 * 1000,
      queryText: "old",
      contextWindow: "old",
      strategyId: "baseline",
      candidatesJson: "[]",
      surfacedToolIds: "",
      belowThreshold: 0,
      latencyMs: 1,
    });
    db.insertRouteTrace({
      sessionId: "s-new",
      ts: Date.now(),
      queryText: "new",
      contextWindow: "new",
      strategyId: "baseline",
      candidatesJson: "[]",
      surfacedToolIds: "",
      belowThreshold: 0,
      latencyMs: 1,
    });

    const deleted = store.prune();
    expect(deleted).toBe(1);
    db.close();
  });

  it("logs warning on write failure but does not throw", async () => {
    const db = new ToolStreamDatabase(":memory:");
    db.close(); // force write to fail
    const store = new TraceStore(db, 14);

    expect(() => store.write(sampleTrace())).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
