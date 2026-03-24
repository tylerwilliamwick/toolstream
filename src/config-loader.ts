// src/config-loader.ts - YAML config parsing and validation

import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { ToolStreamConfig, ServerConfig, AuthConfig } from "./types.js";
import { logger } from "./logger.js";

export class ConfigValidationError extends Error {
  constructor(
    public field: string,
    message: string
  ) {
    super(`Config error at '${field}': ${message}`);
    this.name = "ConfigValidationError";
  }
}

export function loadConfig(configPath: string): ToolStreamConfig {
  const raw = readFileSync(configPath, "utf-8");
  let doc: any;
  try {
    doc = yaml.load(raw) as any;
  } catch (err) {
    throw new ConfigValidationError(
      "root",
      `Invalid YAML syntax: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!doc || typeof doc !== "object") {
    throw new ConfigValidationError("root", "Config file is empty or not an object");
  }

  const ts = doc.toolstream;
  if (!ts) {
    throw new ConfigValidationError("toolstream", "Missing required section 'toolstream'");
  }

  // Validate transport
  if (!ts.transport) {
    throw new ConfigValidationError("toolstream.transport", "Missing required field");
  }

  // Validate embedding
  if (!ts.embedding) {
    throw new ConfigValidationError("toolstream.embedding", "Missing required field");
  }
  const provider = ts.embedding.provider;
  if (provider !== "local" && provider !== "openai") {
    throw new ConfigValidationError(
      "toolstream.embedding.provider",
      `Must be 'local' or 'openai', got '${provider}'`
    );
  }

  // Validate routing
  if (!ts.routing) {
    throw new ConfigValidationError("toolstream.routing", "Missing required field");
  }
  const topK = ts.routing.top_k;
  if (typeof topK !== "number" || topK < 1 || topK > 20) {
    throw new ConfigValidationError(
      "toolstream.routing.top_k",
      `Must be a number between 1 and 20, got '${topK}'`
    );
  }
  const threshold = ts.routing.confidence_threshold;
  if (typeof threshold !== "number" || threshold < 0 || threshold > 1) {
    throw new ConfigValidationError(
      "toolstream.routing.confidence_threshold",
      `Must be a number between 0.0 and 1.0, got '${threshold}'`
    );
  }

  // Validate storage
  if (!ts.storage) {
    throw new ConfigValidationError("toolstream.storage", "Missing required field");
  }

  // Validate servers
  const servers = doc.servers;
  if (!Array.isArray(servers)) {
    throw new ConfigValidationError("servers", "Missing required array 'servers'");
  }
  if (servers.length === 0) {
    logger.warn("No servers configured. Toolstream will start with meta-tools only.");
  }

  const parsedServers: ServerConfig[] = servers.map(
    (s: any, i: number) => parseServerConfig(s, i)
  );

  return {
    transport: {
      stdio: Boolean(ts.transport.stdio),
      http: ts.transport.http
        ? {
            enabled: Boolean(ts.transport.http.enabled),
            port: Number(ts.transport.http.port) || 3000,
            host: String(ts.transport.http.host || "127.0.0.1"),
          }
        : undefined,
    },
    embedding: {
      provider: provider as "local" | "openai",
      model: String(ts.embedding.model || "all-MiniLM-L6-v2"),
      openaiApiKey: ts.embedding.openai_api_key
        ? resolveEnvVar(ts.embedding.openai_api_key, "toolstream.embedding.openai_api_key")
        : undefined,
    },
    routing: {
      topK: topK,
      confidenceThreshold: threshold,
      contextWindowTurns: Number(ts.routing.context_window_turns) || 3,
    },
    storage: {
      provider: ts.storage.provider === "pgvector" ? "pgvector" : "sqlite",
      sqlitePath: String(ts.storage.sqlite_path || "./toolstream.db"),
    },
    servers: parsedServers,
    logging: ts.logging ? {
      level: (ts.logging.level || "info") as "error" | "warn" | "info" | "debug",
      file: String(ts.logging.file || "~/.toolstream/logs/toolstream.log"),
      maxSizeMb: Number(ts.logging.max_size_mb) || 50,
    } : undefined,
    notifications: ts.notifications ? {
      telegram: ts.notifications.telegram ? {
        botToken: String(ts.notifications.telegram.bot_token || ""),
        chatId: String(ts.notifications.telegram.chat_id || ""),
        events: Array.isArray(ts.notifications.telegram.events)
          ? ts.notifications.telegram.events.map(String)
          : ["server_down", "server_recovered"],
        throttleSeconds: Number(ts.notifications.telegram.throttle_seconds) || 300,
      } : undefined,
    } : undefined,
  };
}

function parseServerConfig(raw: any, index: number): ServerConfig {
  const prefix = `servers[${index}]`;

  if (!raw.id) {
    throw new ConfigValidationError(`${prefix}.id`, "Missing required field");
  }
  if (!raw.name) {
    throw new ConfigValidationError(`${prefix}.name`, "Missing required field");
  }
  if (!raw.transport) {
    throw new ConfigValidationError(`${prefix}.transport`, "Missing required field");
  }
  if (raw.transport !== "stdio" && raw.transport !== "http") {
    throw new ConfigValidationError(
      `${prefix}.transport`,
      `Must be 'stdio' or 'http', got '${raw.transport}'`
    );
  }
  if (raw.transport === "http") {
    throw new ConfigValidationError(
      `${prefix}.transport`,
      "HTTP transport is not yet supported. Use 'stdio' instead."
    );
  }

  if (raw.transport === "stdio" && !raw.command) {
    throw new ConfigValidationError(
      `${prefix}.command`,
      "Required for stdio transport"
    );
  }
  if (raw.transport === "http" && !raw.url) {
    throw new ConfigValidationError(
      `${prefix}.url`,
      "Required for http transport"
    );
  }

  const auth = parseAuthConfig(raw.auth || { type: "none" }, `${prefix}.auth`);

  return {
    id: String(raw.id),
    name: String(raw.name),
    transport: raw.transport as "stdio" | "http",
    command: raw.command ? String(raw.command) : undefined,
    args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
    url: raw.url ? String(raw.url) : undefined,
    auth,
  };
}

function parseAuthConfig(raw: any, prefix: string): AuthConfig {
  const validTypes = ["none", "env", "bearer", "header"];
  if (!validTypes.includes(raw.type)) {
    throw new ConfigValidationError(
      `${prefix}.type`,
      `Must be one of: ${validTypes.join(", ")}. Got '${raw.type}'`
    );
  }

  const config: AuthConfig = { type: raw.type };

  if (raw.type === "env" || raw.type === "bearer") {
    if (!raw.token_env) {
      throw new ConfigValidationError(
        `${prefix}.token_env`,
        `Required for auth type '${raw.type}'`
      );
    }
    config.tokenEnv = String(raw.token_env);
    // Resolve the env var to validate it exists
    resolveEnvVar(`$${raw.token_env}`, `${prefix}.token_env`);
  }

  if (raw.type === "header") {
    if (!raw.header_name) {
      throw new ConfigValidationError(
        `${prefix}.header_name`,
        "Required for auth type 'header'"
      );
    }
    config.headerName = String(raw.header_name);
  }

  return config;
}

function resolveEnvVar(value: string, fieldPath: string): string {
  if (!value.startsWith("$")) return value;
  const envName = value.slice(1);
  const resolved = process.env[envName];
  if (resolved === undefined) {
    throw new ConfigValidationError(
      fieldPath,
      `Environment variable '${envName}' is not set`
    );
  }
  return resolved;
}
