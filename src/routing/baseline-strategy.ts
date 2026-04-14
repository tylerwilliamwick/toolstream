// src/routing/baseline-strategy.ts - Baseline routing strategy (current logic extracted)

import type { EmbeddingEngine } from "../embedding-engine.js";
import type { ToolRegistry } from "../tool-registry.js";
import type { ScoredTool } from "../types.js";
import type {
  RoutingStrategy,
  RouteStrategyInput,
  RouteStrategyResult,
  RouteTrace,
  TraceCandidate,
} from "./strategy.js";

export interface BaselineStrategyDeps {
  engine: EmbeddingEngine;
  registry: ToolRegistry;
  topK: number;
  threshold: number;
  contextWindowTurns: number;
  serverTopK: Map<string, number>;
}

export class BaselineStrategy implements RoutingStrategy {
  readonly id = "baseline";
  private engine: EmbeddingEngine;
  private registry: ToolRegistry;
  private topK: number;
  private threshold: number;
  private contextWindowTurns: number;
  private serverTopK: Map<string, number>;

  constructor(deps: BaselineStrategyDeps) {
    this.engine = deps.engine;
    this.registry = deps.registry;
    this.topK = deps.topK;
    this.threshold = deps.threshold;
    this.contextWindowTurns = deps.contextWindowTurns;
    this.serverTopK = deps.serverTopK;
  }

  async route(input: RouteStrategyInput): Promise<RouteStrategyResult> {
    const start = Date.now();
    const window = input.contextBuffer.slice(-this.contextWindowTurns);
    const queryText = window.join("\n").trim();

    const baseTrace = (overrides: Partial<RouteTrace>): RouteTrace => ({
      sessionId: input.sessionId,
      ts: start,
      queryText,
      contextWindow: window.join("\n"),
      strategyId: this.id,
      candidates: [],
      surfacedToolIds: [],
      belowThreshold: true,
      latencyMs: Date.now() - start,
      ...overrides,
    });

    if (!queryText) {
      return {
        candidates: [],
        belowThreshold: true,
        trace: baseTrace({
          candidates: [],
          surfacedToolIds: [],
          belowThreshold: true,
          latencyMs: Date.now() - start,
        }),
      };
    }

    const queryVector = await this.engine.embed(queryText);
    let candidates: ScoredTool[] = await this.registry.topKByVector(queryVector, this.topK);

    // Capture base scores BEFORE topic bias for trace
    const traceCandidates: TraceCandidate[] = candidates.map((c) => ({
      toolId: c.tool.id,
      baseScore: c.score,
      boosts: {},
      finalScore: c.score,
    }));

    // Apply session topic bias (matches semantic-router.ts:49-59)
    if (input.sessionContext && input.sessionContext.confidence > 0.5) {
      const dominantId = input.sessionContext.dominantServerId;
      candidates = candidates.map((c) => {
        if (c.tool.serverId === dominantId) {
          return { ...c, score: c.score * 1.3 };
        }
        return c;
      });
      candidates.sort((a, b) => b.score - a.score);

      // Mirror boost into trace candidates
      for (const tc of traceCandidates) {
        const match = candidates.find((c) => c.tool.id === tc.toolId);
        if (match && match.tool.serverId === dominantId) {
          tc.boosts.topic_bias = 1.3;
          tc.finalScore = match.score;
        }
      }
      // Re-sort trace to match candidate order
      traceCandidates.sort((a, b) => b.finalScore - a.finalScore);
    }

    const passing = candidates.filter((c) => c.score >= this.threshold);
    const belowThreshold = passing.length === 0;

    return {
      candidates: passing,
      belowThreshold,
      trace: baseTrace({
        candidates: traceCandidates,
        surfacedToolIds: passing.map((c) => c.tool.id),
        belowThreshold,
        latencyMs: Date.now() - start,
      }),
    };
  }
}
