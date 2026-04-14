import { describe, it, expect } from "vitest";
import type { RouteTrace, RoutingStrategy } from "../../src/routing/strategy.js";

describe("RouteTrace shape", () => {
  it("has all required fields", () => {
    const trace: RouteTrace = {
      sessionId: "s1",
      ts: 1,
      queryText: "q",
      contextWindow: "ctx",
      strategyId: "baseline",
      candidates: [
        {
          toolId: "fs:read_file",
          baseScore: 0.8,
          boosts: {},
          finalScore: 0.8,
        },
      ],
      surfacedToolIds: ["fs:read_file"],
      belowThreshold: false,
      latencyMs: 3,
    };
    expect(trace.strategyId).toBe("baseline");
    expect(trace.candidates[0].finalScore).toBe(0.8);
  });
});

describe("RoutingStrategy contract", () => {
  it("has an id and a route method", () => {
    const stub: RoutingStrategy = {
      id: "stub",
      async route() {
        return {
          candidates: [],
          belowThreshold: true,
          trace: {
            sessionId: "",
            ts: 0,
            queryText: "",
            contextWindow: "",
            strategyId: "stub",
            candidates: [],
            surfacedToolIds: [],
            belowThreshold: true,
            latencyMs: 0,
          },
        };
      },
    };
    expect(stub.id).toBe("stub");
  });
});
