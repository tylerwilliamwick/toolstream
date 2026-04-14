// src/cli/health.ts - Quick health check reading directly from SQLite

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { ToolStreamDatabase } from "../database.js";
import { loadConfig } from "../config-loader.js";

export async function healthCommand(configPath?: string): Promise<void> {
  let dbPath = resolve("./toolstream.db");

  if (configPath) {
    try {
      const config = loadConfig(configPath);
      dbPath = resolve(config.storage.sqlitePath);
    } catch {
      // Fall through to default
    }
  }

  if (!existsSync(dbPath)) {
    process.stderr.write(`[ToolStream] No database found at ${dbPath}\n`);
    process.stderr.write("Run 'toolstream start' first to initialize the database.\n");
    process.exit(1);
  }

  const db = new ToolStreamDatabase(dbPath);

  try {
    const servers = db.getAllServers();
    const tools = db.getAllActiveTools();
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    process.stdout.write("ToolStream Health Check\n\n");
    process.stdout.write(`Servers: ${servers.length}\n`);
    process.stdout.write(`Tools:   ${tools.length}\n`);

    let degraded = false;

    if (servers.length === 0) {
      process.stdout.write("\nNo servers registered. Run 'toolstream start' to connect.\n");
      degraded = true;
    } else {
      process.stdout.write("\nServer Status:\n");
      for (const server of servers) {
        const lastSync = server.last_synced_at;
        const stale = !lastSync || lastSync < oneHourAgo;
        const status = stale ? "STALE" : "OK";
        const icon = stale ? "!" : "+";

        if (stale) degraded = true;

        const syncStr = lastSync
          ? `${Math.round((now - lastSync) / 60000)} min ago`
          : "never";

        process.stdout.write(
          `  [${icon}] ${server.display_name} (${server.id}): ${server.tool_count} tools, synced ${syncStr} [${status}]\n`
        );
      }
    }

    db.close();
    process.exit(degraded ? 1 : 0);
  } catch (err) {
    db.close();
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }
}
