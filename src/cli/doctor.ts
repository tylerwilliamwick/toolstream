// src/cli/doctor.ts - Validate Toolstream setup

import { existsSync, accessSync, constants } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, ConfigValidationError } from "../config-loader.js";

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export async function runDoctor(configPath: string): Promise<void> {
  const results: CheckResult[] = [];

  // Check 1: Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0]);
  results.push({
    name: "Node.js version",
    passed: major >= 20,
    detail: major >= 20 ? `v${nodeVersion}` : `v${nodeVersion} (requires >= 20)`,
  });

  // Check 2: Config file exists
  const configExists = existsSync(configPath);
  results.push({
    name: "Config file",
    passed: configExists,
    detail: configExists ? configPath : `Not found: ${configPath}`,
  });

  // Check 3: Config validation
  let config: any = null;
  if (configExists) {
    try {
      config = loadConfig(configPath);
      results.push({
        name: "Config syntax",
        passed: true,
        detail: `${config.servers.length} server(s) configured`,
      });
    } catch (err) {
      results.push({
        name: "Config syntax",
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Check 4: SQLite path writable
  if (config) {
    const sqliteDir = dirname(config.storage.sqlitePath);
    try {
      accessSync(sqliteDir, constants.W_OK);
      results.push({
        name: "SQLite path",
        passed: true,
        detail: config.storage.sqlitePath,
      });
    } catch {
      results.push({
        name: "SQLite path",
        passed: false,
        detail: `Directory not writable: ${sqliteDir}`,
      });
    }
  }

  // Check 5: Embedding model
  // The model downloads on first use. Check if the cache directory has it.
  const modelCachePath = `${process.env.HOME}/.cache/huggingface/hub/models--Xenova--all-MiniLM-L6-v2`;
  const modelExists = existsSync(modelCachePath);
  results.push({
    name: "Embedding model",
    passed: modelExists,
    detail: modelExists
      ? "all-MiniLM-L6-v2 (cached)"
      : "Not downloaded yet. Will download on first start (~90MB).",
  });

  // Check 6: Log directory
  const logDir = `${process.env.HOME}/.toolstream/logs`;
  const logDirExists = existsSync(logDir);
  results.push({
    name: "Log directory",
    passed: logDirExists,
    detail: logDirExists ? logDir : `Run: mkdir -p ${logDir}`,
  });

  // Print results
  process.stdout.write("\nToolstream Doctor\n\n");
  let allPassed = true;
  for (const r of results) {
    const icon = r.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    process.stdout.write(`  ${icon} ${r.name}: ${r.detail}\n`);
    if (!r.passed) allPassed = false;
  }
  process.stdout.write("\n");

  if (allPassed) {
    process.stdout.write("  All checks passed. Ready to start.\n\n");
  } else {
    process.stdout.write("  Some checks failed. Fix the issues above before starting.\n\n");
    process.exit(1);
  }
}
