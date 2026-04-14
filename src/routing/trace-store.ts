// src/routing/trace-store.ts - Async persistence for route traces

import type { ToolStreamDatabase } from "../database.js";
import { logger } from "../logger.js";
import type { RouteTrace } from "./strategy.js";

export class TraceStore {
  private db: ToolStreamDatabase;
  private retentionDays: number;

  constructor(db: ToolStreamDatabase, retentionDays: number) {
    this.db = db;
    this.retentionDays = retentionDays;
  }

  write(trace: RouteTrace): void {
    setImmediate(() => {
      try {
        this.db.insertRouteTrace({
          sessionId: trace.sessionId,
          ts: trace.ts,
          queryText: trace.queryText,
          contextWindow: trace.contextWindow,
          strategyId: trace.strategyId,
          candidatesJson: JSON.stringify(trace.candidates),
          surfacedToolIds: trace.surfacedToolIds.join(","),
          belowThreshold: trace.belowThreshold ? 1 : 0,
          latencyMs: trace.latencyMs,
        });
      } catch (err) {
        logger.warn(
          `[TraceStore] Write failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });
  }

  prune(): number {
    try {
      return this.db.pruneRouteTraces(this.retentionDays);
    } catch (err) {
      logger.warn(
        `[TraceStore] Prune failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return 0;
    }
  }
}
