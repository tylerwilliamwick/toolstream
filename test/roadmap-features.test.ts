import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolStreamDatabase } from "../src/database.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";

function tmpDbPath(): string {
  const dir = join(tmpdir(), "toolstream-test");
  mkdirSync(dir, { recursive: true });
  return join(dir, `roadmap-${randomUUID()}.db`);
}

describe("Shipped features (roadmap v1.0)", () => {
  describe("Web dashboard", () => {
    it("ui/server module exports startUIServer as a function", async () => {
      const mod = await import("../src/ui/server.js");
      expect(typeof mod.startUIServer).toBe("function");
    });
  });

  describe("Self-healing reconnection", () => {
    it("UpstreamManager exposes forceReconnect as a method", async () => {
      const mod = await import("../src/upstream-manager.js");
      expect(typeof mod.UpstreamManager.prototype.forceReconnect).toBe(
        "function"
      );
    });
  });

  describe("SQLite persistence", () => {
    let dbPath: string;

    afterEach(() => {
      try {
        unlinkSync(dbPath);
      } catch {}
      try {
        unlinkSync(dbPath + "-wal");
      } catch {}
      try {
        unlinkSync(dbPath + "-shm");
      } catch {}
    });

    it("server registrations survive close and reopen", () => {
      dbPath = tmpDbPath();

      // Insert a server, then close
      const db1 = new ToolStreamDatabase(dbPath);
      db1.insertServer("test-srv", "Test Server", "stdio");
      db1.close();

      // Reopen and verify
      const db2 = new ToolStreamDatabase(dbPath);
      const servers = db2.getAllServers();
      expect(servers.some((s: { id: string }) => s.id === "test-srv")).toBe(
        true
      );
      db2.close();
    });
  });

  describe("Auth and env_passthrough", () => {
    it("server config accepts envPassthrough field without error", async () => {
      const { loadConfig } = await import("../src/config-loader.js");
      const { writeFileSync } = await import("node:fs");
      const configPath = join(
        tmpdir(),
        `toolstream-test/auth-${randomUUID()}.yaml`
      );
      mkdirSync(join(tmpdir(), "toolstream-test"), { recursive: true });

      const yaml = `
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
  - id: "atlassian"
    name: "Atlassian"
    transport: "stdio"
    command: "uvx"
    args: ["mcp-atlassian"]
    auth:
      type: "none"
    env_passthrough:
      - "JIRA_URL"
      - "JIRA_USERNAME"
      - "JIRA_API_TOKEN"
`;
      writeFileSync(configPath, yaml);

      try {
        const config = loadConfig(configPath);
        const atlassian = config.servers.find(
          (s: { id: string }) => s.id === "atlassian"
        );
        expect(atlassian).toBeDefined();
        expect(atlassian!.envPassthrough).toEqual([
          "JIRA_URL",
          "JIRA_USERNAME",
          "JIRA_API_TOKEN",
        ]);
      } finally {
        try {
          unlinkSync(configPath);
        } catch {}
      }
    });
  });
});
