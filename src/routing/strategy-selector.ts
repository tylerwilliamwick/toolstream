// src/routing/strategy-selector.ts - Deterministic strategy bucketing by session id

import type { RoutingStrategy } from "./strategy.js";
import type { RoutingStrategyConfig } from "../types.js";

export class StrategySelector {
  private strategies: Map<string, RoutingStrategy> = new Map();
  private orderedIds: string[] = [];
  private defaultId: string;

  constructor(strategies: RoutingStrategy[], configs: RoutingStrategyConfig[]) {
    for (const s of strategies) {
      this.strategies.set(s.id, s);
    }

    const configured = configs.filter((c) => this.strategies.has(c.id));

    const defaultEntry = configured.find((c) => c.default === true) ?? configured[0];
    if (!defaultEntry) {
      throw new Error("StrategySelector: no default strategy configured");
    }
    this.defaultId = defaultEntry.id;
    this.orderedIds = configured.map((c) => c.id);
  }

  pick(sessionId: string): RoutingStrategy {
    if (this.orderedIds.length === 1) {
      return this.strategies.get(this.defaultId)!;
    }
    const hash = this.hashString(sessionId);
    const idx = hash % this.orderedIds.length;
    const pickedId = this.orderedIds[idx];
    return this.strategies.get(pickedId) ?? this.strategies.get(this.defaultId)!;
  }

  private hashString(s: string): number {
    // FNV-1a 32-bit hash
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
}
