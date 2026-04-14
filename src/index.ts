#!/usr/bin/env node
// src/index.ts - ToolStream CLI router

import { parseArgs } from "node:util";

const HELP = `
ToolStream - Lazy tool loading MCP proxy

Usage:
  toolstream start [config] [--ui]   Start the proxy (default: toolstream.config.yaml)
  toolstream init                    Create a new config file interactively
  toolstream add-server              Add a server to an existing config
  toolstream health                  Check server health from the database
  toolstream doctor [config]         Validate Toolstream setup
  toolstream stats [--limit N] [--json] [--oracle] [--db path]
                                     Show usage analytics
  toolstream explain <session-id> [--limit N] [--db path]
                                     Show route traces for a session
  toolstream --help                  Show this help

Options:
  --ui        Start the web dashboard alongside the proxy
  --oracle    Show Oracle implicit precision metrics (with stats)
  --help, -h  Show help
`.trim();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      ui: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      limit: { type: "string" },
      json: { type: "boolean", default: false },
      db: { type: "string" },
      oracle: { type: "boolean", default: false },
    },
    strict: false,
  });

  if (values.help || positionals.length === 0) {
    // Default to 'start' if no subcommand given and not --help
    if (!values.help && positionals.length === 0) {
      // Legacy behavior: no args = start with default config
      const { startCommand } = await import("./cli/start.js");
      await startCommand("toolstream.config.yaml", {
        ui: values.ui as boolean,
      });
      return;
    }
    process.stdout.write(HELP + "\n");
    return;
  }

  const subcommand = positionals[0];

  switch (subcommand) {
    case "start": {
      const configPath = positionals[1] || "toolstream.config.yaml";
      const { startCommand } = await import("./cli/start.js");
      await startCommand(configPath, { ui: values.ui as boolean });
      break;
    }

    case "init": {
      const { initCommand } = await import("./cli/init.js");
      await initCommand();
      break;
    }

    case "add-server": {
      const { addServerCommand } = await import("./cli/add-server.js");
      await addServerCommand();
      break;
    }

    case "health": {
      const { healthCommand } = await import("./cli/health.js");
      const configPath = positionals[1];
      await healthCommand(configPath);
      break;
    }

    case "doctor": {
      const { runDoctor } = await import("./cli/doctor.js");
      const configFile = positionals[1] || "toolstream.config.yaml";
      await runDoctor(configFile);
      break;
    }

    case "stats": {
      const { statsCommand } = await import("./cli/stats.js");
      await statsCommand({
        limit: (values as any).limit ? Number((values as any).limit) : 10,
        json: !!(values as any).json,
        dbPath: (values as any).db || "./toolstream.db",
        oracle: !!(values as any).oracle,
      });
      break;
    }

    case "explain": {
      const sessionId = positionals[1];
      if (!sessionId) {
        console.error("Usage: toolstream explain <session-id> [--limit N] [--db path]");
        process.exit(1);
      }
      const { explainCommand } = await import("./cli/explain.js");
      await explainCommand({
        sessionId,
        limit: (values as any).limit ? Number((values as any).limit) : 10,
        dbPath: (values as any).db || "./toolstream.db",
      });
      break;
    }

    default:
      process.stderr.write(`Unknown command: ${subcommand}\n`);
      process.stdout.write(HELP + "\n");
      process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[ToolStream] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
