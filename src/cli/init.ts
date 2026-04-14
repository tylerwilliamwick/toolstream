// src/cli/init.ts - Interactive config wizard

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Dynamic import for @inquirer/prompts (may not be installed in all environments)
async function getPrompts() {
  const { input, select, confirm, number } = await import(
    "@inquirer/prompts"
  );
  return { input, select, confirm, number };
}

interface ServerEntry {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  auth: {
    type: "none" | "env" | "bearer";
    token_env?: string;
  };
}

export async function initCommand(): Promise<void> {
  const configPath = resolve("toolstream.config.yaml");

  // Overwrite guard
  if (existsSync(configPath)) {
    const { confirm } = await getPrompts();
    const overwrite = await confirm({
      message:
        "toolstream.config.yaml already exists. Overwrite? (Use 'toolstream add-server' to add a server instead)",
      default: false,
    });
    if (!overwrite) {
      process.stdout.write("Config not modified. Use 'toolstream add-server' to add servers.\n");
      return;
    }
  }

  const { input, select, number, confirm } = await getPrompts();

  process.stdout.write("\nToolStream Configuration Wizard\n\n");

  // Routing preferences
  const topK = await number({
    message: "How many tools to surface per turn? (1-20)",
    default: 5,
    validate: (v) =>
      v !== undefined && v >= 1 && v <= 20
        ? true
        : "Must be between 1 and 20",
  });

  const threshold = await number({
    message: "Minimum confidence threshold? (0.0-1.0, lower = more tools)",
    default: 0.3,
    validate: (v) =>
      v !== undefined && v >= 0 && v <= 1
        ? true
        : "Must be between 0.0 and 1.0",
  });

  // Servers
  const servers: ServerEntry[] = [];
  let addMore = true;

  while (addMore) {
    process.stdout.write(`\n--- Add Server ${servers.length + 1} ---\n`);
    const server = await promptServer();
    servers.push(server);

    addMore = await confirm({
      message: "Add another server?",
      default: false,
    });
  }

  // Generate YAML
  const yaml = generateConfig(topK ?? 5, threshold ?? 0.3, servers);

  // Validate before writing
  try {
    const { loadConfig } = await import("../config-loader.js");
    const tmpPath = configPath + ".tmp";
    writeFileSync(tmpPath, yaml);
    try {
      loadConfig(tmpPath);
    } finally {
      const { unlinkSync } = await import("node:fs");
      try {
        unlinkSync(tmpPath);
      } catch {}
    }
  } catch (err) {
    process.stderr.write(
      `\nValidation failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.stderr.write("Config was not written. Please fix the issue and try again.\n");
    return;
  }

  writeFileSync(configPath, yaml);
  process.stdout.write(`\nConfig written to ${configPath}\n`);
  process.stdout.write("Run 'toolstream start' to launch the proxy.\n");
}

async function promptServer(): Promise<ServerEntry> {
  const { input, select } = await getPrompts();

  const preset = await select({
    message: "Server type",
    choices: [
      { name: "Filesystem", value: "filesystem" },
      { name: "GitHub", value: "github" },
      { name: "Custom (stdio)", value: "custom-stdio" },
      { name: "Custom (HTTP)", value: "custom-http" },
    ],
  });

  if (preset === "filesystem") {
    const path = await input({
      message: "Directory to expose",
      default: process.env.HOME || "/tmp",
    });
    return {
      id: "filesystem",
      name: "Filesystem Server",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", path],
      auth: { type: "none" },
    };
  }

  if (preset === "github") {
    const tokenEnv = await input({
      message: "Environment variable name for GitHub token",
      default: "GITHUB_TOKEN",
    });
    return {
      id: "github",
      name: "GitHub MCP Server",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      auth: { type: "bearer", token_env: tokenEnv },
    };
  }

  // Custom server
  const id = await input({ message: "Server ID (short, no spaces)" });
  const name = await input({ message: "Display name" });

  if (preset === "custom-http") {
    const url = await input({ message: "Server URL" });
    const authType = await select({
      message: "Auth type",
      choices: [
        { name: "None", value: "none" as const },
        { name: "Bearer token (env var)", value: "bearer" as const },
      ],
    });

    const auth: ServerEntry["auth"] = { type: authType };
    if (authType === "bearer") {
      auth.token_env = await input({
        message: "Environment variable name for token",
      });
    }

    return { id, name, transport: "http", url, auth };
  }

  // custom-stdio
  const command = await input({ message: "Command to run" });
  const argsStr = await input({
    message: "Arguments (space-separated)",
    default: "",
  });
  const args = argsStr ? argsStr.split(" ") : [];

  const authType = await select({
    message: "Auth type",
    choices: [
      { name: "None", value: "none" as const },
      { name: "Bearer token (env var)", value: "bearer" as const },
    ],
  });

  const auth: ServerEntry["auth"] = { type: authType };
  if (authType === "bearer") {
    auth.token_env = await input({
      message: "Environment variable name for token",
    });
  }

  return { id, name, transport: "stdio", command, args, auth };
}

function generateConfig(
  topK: number,
  threshold: number,
  servers: ServerEntry[]
): string {
  let yaml = `# toolstream.config.yaml - Generated by toolstream init

toolstream:
  transport:
    stdio: true
    http:
      enabled: false
      port: 3000
      host: "127.0.0.1"

  embedding:
    provider: "local"
    model: "all-MiniLM-L6-v2"

  routing:
    top_k: ${topK}                   # Tools surfaced per turn (1-20)
    confidence_threshold: ${threshold}  # Minimum similarity score (0.0-1.0)
    context_window_turns: 3    # Recent turns used for routing

  storage:
    provider: "sqlite"
    sqlite_path: "./toolstream.db"

servers:
`;

  for (const server of servers) {
    yaml += formatServer(server);
  }

  return yaml;
}

function formatServer(server: ServerEntry): string {
  const escapedName = escapeYaml(server.name);
  let block = `  - id: "${escapeYaml(server.id)}"
    name: "${escapedName}"
    transport: "${server.transport}"
`;

  if (server.transport === "stdio" && server.command) {
    block += `    command: "${escapeYaml(server.command)}"
`;
    if (server.args && server.args.length > 0) {
      const argsStr = server.args.map((a) => `"${escapeYaml(a)}"`).join(", ");
      block += `    args: [${argsStr}]
`;
    }
  }

  if (server.transport === "http" && server.url) {
    block += `    url: "${escapeYaml(server.url)}"
`;
  }

  block += `    auth:
      type: "${server.auth.type}"
`;

  if (server.auth.token_env) {
    block += `      token_env: "${escapeYaml(server.auth.token_env)}"
`;
  }

  block += "\n";
  return block;
}

function escapeYaml(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/#/g, "\\#");
}
