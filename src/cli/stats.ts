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
    process.stderr.write(`Database not found: ${options.dbPath}\n`);
    process.stderr.write("Run ToolStream at least once to create the database.\n");
    process.exit(1);
  }

  const db = new ToolStreamDatabase(options.dbPath);

  try {
    const topTools = db.getTopTools(options.limit);
    const topCooccurrence = db.getTopCooccurrence(options.limit);

    if (options.json) {
      process.stdout.write(JSON.stringify({ topTools, topCooccurrence }, null, 2) + "\n");
      return;
    }

    // Top tools table
    process.stdout.write("\nTop Tools by Call Count\n");
    process.stdout.write("======================\n\n");

    if (topTools.length === 0) {
      process.stdout.write("  No tool call data yet. Use ToolStream to generate analytics.\n\n");
    } else {
      const header = [
        "#".padStart(3),
        "Tool".padEnd(40),
        "Calls".padStart(6),
      ].join("  ");
      process.stdout.write(header + "\n");
      process.stdout.write("-".repeat(header.length) + "\n");

      for (let i = 0; i < topTools.length; i++) {
        const t = topTools[i];
        process.stdout.write(
          [
            String(i + 1).padStart(3),
            t.tool_id.padEnd(40),
            String(t.call_count).padStart(6),
          ].join("  ") + "\n"
        );
      }
    }

    // Co-occurrence table
    process.stdout.write("\nTop Co-occurring Tool Pairs\n");
    process.stdout.write("==========================\n\n");

    if (topCooccurrence.length === 0) {
      process.stdout.write("  No co-occurrence data yet.\n\n");
    } else {
      const coHeader = [
        "#".padStart(3),
        "Tool A".padEnd(30),
        "Tool B".padEnd(30),
        "Count".padStart(6),
      ].join("  ");
      process.stdout.write(coHeader + "\n");
      process.stdout.write("-".repeat(coHeader.length) + "\n");

      for (let i = 0; i < topCooccurrence.length; i++) {
        const c = topCooccurrence[i];
        process.stdout.write(
          [
            String(i + 1).padStart(3),
            c.tool_a_id.padEnd(30),
            c.tool_b_id.padEnd(30),
            String(c.count).padStart(6),
          ].join("  ") + "\n"
        );
      }
    }

    process.stdout.write("\n");
  } finally {
    db.close();
  }
}

