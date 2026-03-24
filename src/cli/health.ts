// src/cli/health.ts - Quick health check reading directly from SQLite

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { ToolStreamDatabase } from "../database.js";

export async function healthCommand(configPath?: string): Promise<void> {
  const dbPath = resolve("./toolstream.db");

  if (!existsSync(dbPath)) {
    console.error("[ToolStream] No database found at ./toolstream.db");
    console.error(
      "Run 'toolstream start' first to initialize the database."
    );
    process.exit(1);
  }

  const db = new ToolStreamDatabase(dbPath);

  try {
    const servers = db.getAllServers();
    const tools = db.getAllActiveTools();
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    console.log("ToolStream Health Check\n");
    console.log(`Servers: ${servers.length}`);
    console.log(`Tools:   ${tools.length}`);

    let degraded = false;

    if (servers.length === 0) {
      console.log("\nNo servers registered. Run 'toolstream start' to connect.");
      degraded = true;
    } else {
      console.log("\nServer Status:");
      for (const server of servers) {
        const lastSync = server.last_synced_at;
        const stale = !lastSync || lastSync < oneHourAgo;
        const status = stale ? "STALE" : "OK";
        const icon = stale ? "!" : "+";

        if (stale) degraded = true;

        const syncStr = lastSync
          ? `${Math.round((now - lastSync) / 60000)} min ago`
          : "never";

        console.log(
          `  [${icon}] ${server.display_name} (${server.id}): ${server.tool_count} tools, synced ${syncStr} [${status}]`
        );
      }
    }

    db.close();
    process.exit(degraded ? 1 : 0);
  } catch (err) {
    db.close();
    console.error(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}
