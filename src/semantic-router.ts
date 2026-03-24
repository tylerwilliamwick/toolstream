// src/semantic-router.ts - Semantic routing with context windowing

import type { EmbeddingEngine } from "./embedding-engine.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { RouteResult, ToolStreamConfig } from "./types.js";

export class SemanticRouter {
  private embedEngine: EmbeddingEngine;
  private registry: ToolRegistry;
  private topK: number;
  private threshold: number;
  private contextWindowTurns: number;

  constructor(
    embedEngine: EmbeddingEngine,
    registry: ToolRegistry,
    routingConfig: ToolStreamConfig["routing"]
  ) {
    this.embedEngine = embedEngine;
    this.registry = registry;
    this.topK = routingConfig.topK;
    this.threshold = routingConfig.confidenceThreshold;
    this.contextWindowTurns = routingConfig.contextWindowTurns;
  }

  async route(contextBuffer: string[]): Promise<RouteResult> {
    const window = contextBuffer.slice(-this.contextWindowTurns);
    const queryText = window.join("\n").trim();
    if (!queryText) {
      return { candidates: [], belowThreshold: true };
    }

    const queryVector = await this.embedEngine.embed(queryText);
    const candidates = await this.registry.topKByVector(queryVector, this.topK);
    const passing = candidates.filter((c) => c.score >= this.threshold);

    return {
      candidates: passing,
      belowThreshold: passing.length === 0,
    };
  }

  async search(query: string, k: number) {
    const queryVector = await this.embedEngine.embed(query);
    return await this.registry.topKByVector(queryVector, k);
  }
}
