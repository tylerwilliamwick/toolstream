import { describe, it, expect } from "vitest";
import { StrategySelector } from "../../src/routing/strategy-selector.js";
import type { RoutingStrategy } from "../../src/routing/strategy.js";

function stubStrategy(id: string): RoutingStrategy {
  return {
    id,
    async route() {
      return {
        candidates: [],
        belowThreshold: true,
        trace: {
          sessionId: "",
          ts: 0,
          queryText: "",
          contextWindow: "",
          strategyId: id,
          candidates: [],
          surfacedToolIds: [],
          belowThreshold: true,
          latencyMs: 0,
        },
      };
    },
  };
}

describe("StrategySelector", () => {
  it("returns default strategy when only one configured", () => {
    const baseline = stubStrategy("baseline");
    const selector = new StrategySelector([baseline], [{ id: "baseline", default: true }]);
    expect(selector.pick("any-session-id").id).toBe("baseline");
  });

  it("is deterministic for the same session id", () => {
    const a = stubStrategy("baseline");
    const b = stubStrategy("null_strategy");
    const selector = new StrategySelector(
      [a, b],
      [
        { id: "baseline", default: true },
        { id: "null_strategy" },
      ]
    );
    const pick1 = selector.pick("session-abc");
    const pick2 = selector.pick("session-abc");
    expect(pick1.id).toBe(pick2.id);
  });

  it("distributes across strategies for different session ids", () => {
    const a = stubStrategy("baseline");
    const b = stubStrategy("null_strategy");
    const selector = new StrategySelector(
      [a, b],
      [
        { id: "baseline", default: true },
        { id: "null_strategy" },
      ]
    );
    const picks = new Set<string>();
    for (let i = 0; i < 100; i++) {
      picks.add(selector.pick(`s-${i}`).id);
    }
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  it("falls back to default when an unconfigured strategy id is hashed", () => {
    const baseline = stubStrategy("baseline");
    const selector = new StrategySelector([baseline], [{ id: "baseline", default: true }]);
    expect(selector.pick("any").id).toBe("baseline");
  });

  it("throws when no default configured", () => {
    expect(() => new StrategySelector([], [])).toThrow(/default/);
  });
});
