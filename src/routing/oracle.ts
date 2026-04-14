// src/routing/oracle.ts - Implicit precision@K evaluator

import type { ToolStreamDatabase } from "../database.js";
import type { OracleConfig } from "../types.js";

export interface OracleMetric {
  strategyId: string;
  hits: number;
  misses: number;
  precision: number;
  windowDays: number;
}

export class Oracle {
  private db: ToolStreamDatabase;
  private config: OracleConfig;

  constructor(db: ToolStreamDatabase, config: OracleConfig) {
    this.db = db;
    this.config = config;
  }

  evalRolling7d(strategyId: string): OracleMetric {
    const windowDays = 7;
    const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const traces = this.db.getRouteTracesByStrategy(strategyId, since);

    let hits = 0;
    let misses = 0;

    for (const trace of traces) {
      if (!trace.surfaced_tool_ids) continue;
      const surfacedIds = trace.surfaced_tool_ids.split(",").filter(Boolean);
      if (surfacedIds.length === 0) continue;

      const called = this.db.getSessionToolCalls(trace.session_id);
      const calledSet = new Set(called.map((c) => c.tool_id));

      for (const toolId of surfacedIds) {
        if (calledSet.has(toolId)) {
          hits++;
        } else {
          misses++;
        }
      }
    }

    const total = hits + misses;
    const precision = total === 0 ? 0 : hits / total;

    return { strategyId, hits, misses, precision, windowDays };
  }
}
