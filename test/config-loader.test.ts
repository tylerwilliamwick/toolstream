import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig, ConfigValidationError } from "../src/config-loader.js";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tmpConfigPath(): string {
  const dir = join(tmpdir(), "toolstream-test");
  mkdirSync(dir, { recursive: true });
  return join(dir, `config-${randomUUID()}.yaml`);
}

const VALID_CONFIG = `
toolstream:
  transport:
    stdio: true
  embedding:
    provider: "local"
    model: "all-MiniLM-L6-v2"
  routing:
    top_k: 5
    confidence_threshold: 0.3
    context_window_turns: 3
  storage:
    provider: "sqlite"
    sqlite_path: "./test.db"

servers:
  - id: "fs"
    name: "Filesystem"
    transport: "stdio"
    command: "echo"
    args: ["test"]
    auth:
      type: "none"
`;

describe("ConfigLoader", () => {
  let configPath: string;

  beforeEach(() => {
    configPath = tmpConfigPath();
  });

  afterEach(() => {
    try {
      unlinkSync(configPath);
    } catch {}
  });

  it("parses valid config", () => {
    writeFileSync(configPath, VALID_CONFIG);
    const config = loadConfig(configPath);

    expect(config.transport.stdio).toBe(true);
    expect(config.embedding.provider).toBe("local");
    expect(config.routing.topK).toBe(5);
    expect(config.routing.confidenceThreshold).toBe(0.3);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].id).toBe("fs");
  });

  it("throws for missing toolstream section", () => {
    writeFileSync(configPath, "servers: []");
    expect(() => loadConfig(configPath)).toThrow(ConfigValidationError);
    expect(() => loadConfig(configPath)).toThrow("toolstream");
  });

  it("throws for missing routing section", () => {
    writeFileSync(
      configPath,
      `
toolstream:
  transport:
    stdio: true
  embedding:
    provider: "local"
    model: "test"
  storage:
    provider: "sqlite"
servers: []
`
    );
    expect(() => loadConfig(configPath)).toThrow("routing");
  });

  it("throws for invalid top_k", () => {
    writeFileSync(
      configPath,
      VALID_CONFIG.replace("top_k: 5", "top_k: 50")
    );
    expect(() => loadConfig(configPath)).toThrow("top_k");
  });

  it("throws for invalid confidence_threshold", () => {
    writeFileSync(
      configPath,
      VALID_CONFIG.replace("confidence_threshold: 0.3", "confidence_threshold: 2.0")
    );
    expect(() => loadConfig(configPath)).toThrow("confidence_threshold");
  });

  it("throws for invalid transport type", () => {
    writeFileSync(
      configPath,
      VALID_CONFIG.replace('transport: "stdio"', 'transport: "grpc"')
    );
    // The second occurrence is the server transport
    expect(() => loadConfig(configPath)).toThrow();
  });

  it("throws for missing command in stdio server", () => {
    const noCmd = VALID_CONFIG.replace('    command: "echo"\n', "");
    writeFileSync(configPath, noCmd);
    expect(() => loadConfig(configPath)).toThrow("command");
  });

  it("rejects HTTP transport as not yet supported", () => {
    const httpConfig = VALID_CONFIG.replace('transport: "stdio"', 'transport: "http"').replace(
      '    command: "echo"\n    args: ["test"]\n',
      '    url: "http://localhost:3000"\n'
    );
    writeFileSync(configPath, httpConfig);
    expect(() => loadConfig(configPath)).toThrow(ConfigValidationError);
    expect(() => loadConfig(configPath)).toThrow("not yet supported");
  });

  it("throws for invalid auth type", () => {
    const badAuth = VALID_CONFIG.replace('type: "none"', 'type: "magic"');
    writeFileSync(configPath, badAuth);
    expect(() => loadConfig(configPath)).toThrow("auth");
  });

  it("throws for unset env var in bearer auth", () => {
    const bearerConfig = VALID_CONFIG.replace(
      'type: "none"',
      'type: "bearer"\n      token_env: "NONEXISTENT_VAR_12345"'
    );
    writeFileSync(configPath, bearerConfig);
    expect(() => loadConfig(configPath)).toThrow("NONEXISTENT_VAR_12345");
  });

  it("validates embedding provider", () => {
    const bad = VALID_CONFIG.replace('provider: "local"', 'provider: "magic"');
    writeFileSync(configPath, bad);
    expect(() => loadConfig(configPath)).toThrow("provider");
  });

  it("throws for empty servers array", () => {
    const emptyServers = VALID_CONFIG.replace(
      /servers:\n.*- id.*\n.*name.*\n.*transport.*\n.*command.*\n.*args.*\n.*auth.*\n.*type.*\n/s,
      "servers: []\n"
    );
    writeFileSync(configPath, emptyServers);
    expect(() => loadConfig(configPath)).toThrow("At least one server must be configured");
  });

  it("throws for duplicate server ids", () => {
    const dupServers = VALID_CONFIG + `  - id: "fs"
    name: "Filesystem Duplicate"
    transport: "stdio"
    command: "echo"
    args: ["dup"]
    auth:
      type: "none"
`;
    writeFileSync(configPath, dupServers);
    expect(() => loadConfig(configPath)).toThrow("Duplicate server id 'fs'");
  });

  it("throws ConfigValidationError with user-friendly message for malformed YAML", () => {
    writeFileSync(configPath, "toolstream:\n  transport: [\n  bad yaml here");
    expect(() => loadConfig(configPath)).toThrow(ConfigValidationError);
    expect(() => loadConfig(configPath)).toThrow("Invalid YAML syntax");
  });
});
