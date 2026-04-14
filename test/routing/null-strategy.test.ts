import { describe, it, expect } from "vitest";
import { NullStrategy } from "../../src/routing/null-strategy.js";

describe("NullStrategy", () => {
  it("has id 'null_strategy'", () => {
    const s = new NullStrategy();
    expect(s.id).toBe("null_strategy");
  });

  it("returns no candidates", async () => {
    const s = new NullStrategy();
    const result = await s.route({
      sessionId: "s1",
      contextBuffer: ["hello"],
    });
    expect(result.candidates).toEqual([]);
    expect(result.belowThreshold).toBe(true);
  });

  it("emits a trace with strategyId 'null_strategy'", async () => {
    const s = new NullStrategy();
    const result = await s.route({
      sessionId: "s1",
      contextBuffer: ["hello"],
    });
    expect(result.trace.strategyId).toBe("null_strategy");
    expect(result.trace.candidates).toEqual([]);
    expect(result.trace.belowThreshold).toBe(true);
  });
});
