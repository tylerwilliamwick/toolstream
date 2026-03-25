// src/cli/stats.ts - CLI command for viewing usage analytics

import { ToolStreamDatabase } from "../database.js";
import { existsSync } from "node:fs";

interface StatsOptions {
  limit: number;
  json: boolean;
  dbPath: string;
}

export async function statsCommand(options: StatsOptions): Promise<void> {
  if (!existsSync(options.dbPath)) {
    console.error(`Database not found: ${options.dbPath}`);
    console.error("Run ToolStream at least once to create the database.");
    process.exit(1);
  }

  const db = new ToolStreamDatabase(options.dbPath);

  try {
    const topTools = db.getTopTools(options.limit);
    const topCooccurrence = db.getTopCooccurrence(options.limit);

    if (options.json) {
      console.log(JSON.stringify({ topTools, topCooccurrence }, null, 2));
      return;
    }

    // Top tools table
    console.log("\nTop Tools by Call Count");
    console.log("======================\n");

    if (topTools.length === 0) {
      console.log("  No tool call data yet. Use ToolStream to generate analytics.\n");
    } else {
      const header = [
        "#".padStart(3),
        "Tool".padEnd(40),
        "Calls".padStart(6),
      ].join("  ");
      console.log(header);
      console.log("-".repeat(header.length));

      for (let i = 0; i < topTools.length; i++) {
        const t = topTools[i];
        console.log(
          [
            String(i + 1).padStart(3),
            t.tool_id.padEnd(40),
            String(t.call_count).padStart(6),
          ].join("  ")
        );
      }
    }

    // Co-occurrence table
    console.log("\nTop Co-occurring Tool Pairs");
    console.log("==========================\n");

    if (topCooccurrence.length === 0) {
      console.log("  No co-occurrence data yet.\n");
    } else {
      const coHeader = [
        "#".padStart(3),
        "Tool A".padEnd(30),
        "Tool B".padEnd(30),
        "Count".padStart(6),
      ].join("  ");
      console.log(coHeader);
      console.log("-".repeat(coHeader.length));

      for (let i = 0; i < topCooccurrence.length; i++) {
        const c = topCooccurrence[i];
        console.log(
          [
            String(i + 1).padStart(3),
            c.tool_a_id.padEnd(30),
            c.tool_b_id.padEnd(30),
            String(c.count).padStart(6),
          ].join("  ")
        );
      }
    }

    console.log();
  } finally {
    db.close();
  }
}

