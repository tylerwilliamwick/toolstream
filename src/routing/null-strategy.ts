// src/routing/null-strategy.ts - Returns no candidates; smoke-tests the strategy pipeline

import type {
  RoutingStrategy,
  RouteStrategyInput,
  RouteStrategyResult,
} from "./strategy.js";

export class NullStrategy implements RoutingStrategy {
  readonly id = "null_strategy";

  async route(input: RouteStrategyInput): Promise<RouteStrategyResult> {
    const now = Date.now();
    return {
      candidates: [],
      belowThreshold: true,
      trace: {
        sessionId: input.sessionId,
        ts: now,
        queryText: input.contextBuffer.join("\n"),
        contextWindow: input.contextBuffer.join("\n"),
        strategyId: this.id,
        candidates: [],
        surfacedToolIds: [],
        belowThreshold: true,
        latencyMs: 0,
      },
    };
  }
}
