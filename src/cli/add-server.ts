// src/cli/add-server.ts - Add a server to existing config

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

async function getPrompts() {
  const { input, select } = await import("@inquirer/prompts");
  return { input, select };
}

export async function addServerCommand(): Promise<void> {
  const configPath = resolve("toolstream.config.yaml");

  if (!existsSync(configPath)) {
    process.stderr.write(
      "No toolstream.config.yaml found. Run 'toolstream init' first.\n"
    );
    process.exit(1);
  }

  const { input, select } = await getPrompts();

  process.stdout.write("\nAdd a new MCP server to your ToolStream config\n\n");

  const preset = await select({
    message: "Server type",
    choices: [
      { name: "Filesystem", value: "filesystem" },
      { name: "GitHub", value: "github" },
      { name: "Custom (stdio)", value: "custom-stdio" },
      { name: "Custom (HTTP)", value: "custom-http" },
    ],
  });

  let serverBlock: string;

  if (preset === "filesystem") {
    const path = await input({
      message: "Directory to expose",
      default: process.env.HOME || "/tmp",
    });
    serverBlock = formatServerBlock({
      id: "filesystem",
      name: "Filesystem Server",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", path],
      authType: "none",
    });
  } else if (preset === "github") {
    const tokenEnv = await input({
      message: "Environment variable name for GitHub token",
      default: "GITHUB_TOKEN",
    });
    serverBlock = formatServerBlock({
      id: "github",
      name: "GitHub MCP Server",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      authType: "bearer",
      tokenEnv,
    });
  } else if (preset === "custom-http") {
    const id = await input({ message: "Server ID (short, no spaces)" });
    const name = await input({ message: "Display name" });
    const url = await input({ message: "Server URL" });
    const authType = (await select({
      message: "Auth type",
      choices: [
        { name: "None", value: "none" },
        { name: "Bearer token (env var)", value: "bearer" },
      ],
    })) as "none" | "bearer";

    let tokenEnv: string | undefined;
    if (authType === "bearer") {
      tokenEnv = await input({
        message: "Environment variable name for token",
      });
    }

    serverBlock = formatServerBlock({
      id,
      name,
      transport: "http",
      url,
      authType,
      tokenEnv,
    });
  } else {
    // custom-stdio
    const id = await input({ message: "Server ID (short, no spaces)" });
    const name = await input({ message: "Display name" });
    const command = await input({ message: "Command to run" });
    const argsStr = await input({
      message: "Arguments (space-separated)",
      default: "",
    });
    const args = argsStr ? argsStr.split(" ") : [];
    const authType = (await select({
      message: "Auth type",
      choices: [
        { name: "None", value: "none" },
        { name: "Bearer token (env var)", value: "bearer" },
      ],
    })) as "none" | "bearer";

    let tokenEnv: string | undefined;
    if (authType === "bearer") {
      tokenEnv = await input({
        message: "Environment variable name for token",
      });
    }

    serverBlock = formatServerBlock({
      id,
      name,
      transport: "stdio",
      command,
      args,
      authType,
      tokenEnv,
    });
  }

  // Read existing config and append
  const existingContent = readFileSync(configPath, "utf-8");
  const newContent = existingContent.trimEnd() + "\n\n" + serverBlock;

  // Validate via temp file
  const tmpPath = configPath + ".tmp";
  writeFileSync(tmpPath, newContent);

  try {
    const { loadConfig } = await import("../config-loader.js");
    loadConfig(tmpPath);
    // Validation passed for all servers including the new one
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Distinguish between pre-existing server errors and new server errors
    // Try loading the original config to see if it already had errors
    let originalHadErrors = false;
    try {
      const { loadConfig } = await import("../config-loader.js");
      loadConfig(configPath);
    } catch {
      originalHadErrors = true;
    }

    if (originalHadErrors) {
      // Pre-existing config already had issues (likely env var not set in this shell)
      process.stderr.write(`\nWarning: ${message}\n`);
      process.stderr.write(
        "This may be a pre-existing config issue (e.g., env var not set in this shell).\n"
      );
      process.stderr.write("The new server was added. Verify your config before starting.\n\n");
    } else {
      // The new server block caused the error
      process.stderr.write(`\nValidation failed: ${message}\n`);
      process.stderr.write("Server was not added. Please fix the issue and try again.\n");
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(tmpPath);
      } catch {}
      return;
    }
  }

  // Write the new config (overwrite original with appended content)
  writeFileSync(configPath, newContent);
  try {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(tmpPath);
  } catch {}

  process.stdout.write("\nServer added to toolstream.config.yaml\n");
  process.stdout.write("Restart ToolStream to pick up the new server.\n");
}

interface ServerBlockInput {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  authType: "none" | "bearer";
  tokenEnv?: string;
}

function formatServerBlock(server: ServerBlockInput): string {
  const esc = escapeYaml;
  let block = `  - id: "${esc(server.id)}"
    name: "${esc(server.name)}"
    transport: "${server.transport}"`;

  if (server.transport === "stdio" && server.command) {
    block += `\n    command: "${esc(server.command)}"`;
    if (server.args && server.args.length > 0) {
      const argsStr = server.args.map((a) => `"${esc(a)}"`).join(", ");
      block += `\n    args: [${argsStr}]`;
    }
  }

  if (server.transport === "http" && server.url) {
    block += `\n    url: "${esc(server.url)}"`;
  }

  block += `\n    auth:\n      type: "${server.authType}"`;

  if (server.tokenEnv) {
    block += `\n      token_env: "${esc(server.tokenEnv)}"`;
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
