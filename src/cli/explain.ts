// src/cli/explain.ts - Dump recent route traces for a session

import { ToolStreamDatabase } from "../database.js";
import { existsSync } from "node:fs";

export interface ExplainOptions {
  sessionId: string;
  limit: number;
  dbPath?: string;
  db?: ToolStreamDatabase;
}

export async function explainCommand(options: ExplainOptions): Promise<void> {
  let db: ToolStreamDatabase;
  let close = false;

  if (options.db) {
    db = options.db;
  } else {
    if (!options.dbPath || !existsSync(options.dbPath)) {
      process.stderr.write(`Database not found: ${options.dbPath ?? "(none)"}\n`);
      process.exit(1);
    }
    db = new ToolStreamDatabase(options.dbPath);
    close = true;
  }

  try {
    const traces = db.getRouteTracesBySession(options.sessionId, options.limit);
    if (traces.length === 0) {
      console.log(`No traces found for session '${options.sessionId}'.`);
      return;
    }

    console.log(`\nRoute traces for session '${options.sessionId}' (latest ${traces.length}):\n`);
    console.log("=".repeat(70));

    for (const trace of traces) {
      const ts = new Date(trace.ts).toISOString();
      console.log(`\n[${ts}] strategy=${trace.strategy_id} latency=${trace.latency_ms}ms`);
      console.log(`  query:    ${trace.query_text || "(empty)"}`);
      console.log(`  surfaced: ${trace.surfaced_tool_ids || "(none)"}`);
      console.log(`  below_threshold: ${trace.below_threshold ? "yes" : "no"}`);
    }
    console.log();
  } finally {
    if (close) db.close();
  }
}
