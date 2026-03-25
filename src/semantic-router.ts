// src/semantic-router.ts - Semantic routing with context windowing

import type { EmbeddingEngine } from "./embedding-engine.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { RouteResult, ServerConfig, SessionTopicContext, ToolStreamConfig } from "./types.js";

export class SemanticRouter {
  private embedEngine: EmbeddingEngine;
  private registry: ToolRegistry;
  private topK: number;
  private threshold: number;
  private contextWindowTurns: number;
  private serverTopK: Map<string, number> = new Map();

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
  }

  async route(
    contextBuffer: string[],
    sessionContext?: SessionTopicContext | null
  ): Promise<RouteResult> {
    const window = contextBuffer.slice(-this.contextWindowTurns);
    const queryText = window.join("\n").trim();
    if (!queryText) {
      return { candidates: [], belowThreshold: true };
    }

    const queryVector = await this.embedEngine.embed(queryText);
    let candidates = await this.registry.topKByVector(queryVector, this.topK);

    // Apply session topic bias
    if (sessionContext && sessionContext.confidence > 0.5) {
      candidates = candidates.map((c) => {
        if (c.tool.serverId === sessionContext.dominantServerId) {
          return { ...c, score: c.score * 1.3 };
        }
        return c;
      });
      // Re-sort after bias
      candidates.sort((a, b) => b.score - a.score);
    }

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

  getTopKForServer(serverId: string): number {
    return this.serverTopK.get(serverId) ?? this.topK;
  }
}
