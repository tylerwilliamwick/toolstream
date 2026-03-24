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
  toolstream --help                  Show this help

Options:
  --ui        Start the web dashboard alongside the proxy
  --help, -h  Show help
`.trim();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      ui: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
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
    console.log(HELP);
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
      await healthCommand();
      break;
    }

    default:
      console.error(`Unknown command: ${subcommand}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("[ToolStream] Fatal error:", err);
  process.exit(1);
});
