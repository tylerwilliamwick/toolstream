// src/semantic-router.ts - Semantic routing facade, delegates to strategies

import type { EmbeddingEngine } from "./embedding-engine.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { RouteResult, ServerConfig, SessionTopicContext, ToolStreamConfig } from "./types.js";
import { BaselineStrategy } from "./routing/baseline-strategy.js";

export class SemanticRouter {
  private embedEngine: EmbeddingEngine;
  private registry: ToolRegistry;
  private topK: number;
  private threshold: number;
  private contextWindowTurns: number;
  private serverTopK: Map<string, number> = new Map();
  private baseline: BaselineStrategy;

  constructor(
    embedEngine: EmbeddingEngine,
    registry: ToolRegistry,
    routingConfig: ToolStreamConfig["routing"],
    servers?: ServerConfig[]
  ) {
    this.embedEngine = embedEngine;
    this.registry = registry;
    this.topK = routingConfig.topK;
    this.threshold = routingConfig.confidenceThreshold;
    this.contextWindowTurns = routingConfig.contextWindowTurns;

    if (servers) {
      for (const s of servers) {
        if (s.routing?.topK) {
          this.serverTopK.set(s.id, s.routing.topK);
        }
      }
    }

    this.baseline = new BaselineStrategy({
      engine: this.embedEngine,
      registry: this.registry,
      topK: this.topK,
      threshold: this.threshold,
      contextWindowTurns: this.contextWindowTurns,
      serverTopK: this.serverTopK,
    });
  }

  async route(
    contextBuffer: string[],
    sessionContext?: SessionTopicContext | null
  ): Promise<RouteResult> {
    const result = await this.baseline.route({
      sessionId: "legacy",
      contextBuffer,
      sessionContext: sessionContext ?? null,
    });
    return {
      candidates: result.candidates,
      belowThreshold: result.belowThreshold,
    };
  }

  async search(query: string, k: number) {
    const queryVector = await this.embedEngine.embed(query);
    return await this.registry.topKByVector(queryVector, k);
  }

  getTopKForServer(serverId: string): number {
    return this.serverTopK.get(serverId) ?? this.topK;
  }

  get baselineStrategy(): BaselineStrategy {
    return this.baseline;
  }
}
