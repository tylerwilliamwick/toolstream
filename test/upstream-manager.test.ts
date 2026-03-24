import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UpstreamManager } from "../src/upstream-manager.js";
import { ToolStreamDatabase } from "../src/database.js";
import { ToolRegistry } from "../src/tool-registry.js";
import { EmbeddingEngine } from "../src/embedding-engine.js";
import type { ServerConfig } from "../src/types.js";

// Helper: inject a fake connection directly into the manager's private Map
// to avoid spawning real child processes.
function injectFakeConnection(
  manager: UpstreamManager,
  serverId: string,
  config: ServerConfig,
  healthy: boolean
): void {
  const fakeTransport = {
    close: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
    sessionId: undefined,
  } as any;

  const fakeClient = {
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [] }),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;

  const connections: Map<string, any> = (manager as any).connections;
  connections.set(serverId, {
    config,
    client: fakeClient,
    transport: fakeTransport,
    healthy,
  });
}

function makeServerConfig(
  id: string,
  authType: ServerConfig["auth"]["type"],
  tokenEnv?: string,
  headerName?: string
): ServerConfig {
  return {
    id,
    name: `Server ${id}`,
    transport: "stdio",
    command: "echo",
    args: [],
    auth: { type: authType, tokenEnv, headerName },
  };
}

describe("UpstreamManager", () => {
  let db: ToolStreamDatabase;
  let registry: ToolRegistry;
  let manager: UpstreamManager;
  const embedEngine = { embedBatch: vi.fn().mockResolvedValue([]), cosineSimilarity: vi.fn() } as any;

  beforeEach(() => {
    db = new ToolStreamDatabase(":memory:");
    registry = new ToolRegistry(db, embedEngine as EmbeddingEngine);
    manager = new UpstreamManager(registry);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  // --- isConnected ---

  it("isConnected() returns false for a server that was never connected", () => {
    expect(manager.isConnected("nonexistent-server")).toBe(false);
  });

  it("isConnected() returns false for a connected but unhealthy server", () => {
    const config = makeServerConfig("bad-server", "none");
    injectFakeConnection(manager, "bad-server", config, false);
    expect(manager.isConnected("bad-server")).toBe(false);
  });

  it("isConnected() returns true for a healthy connected server", () => {
    const config = makeServerConfig("good-server", "none");
    injectFakeConnection(manager, "good-server", config, true);
    expect(manager.isConnected("good-server")).toBe(true);
  });

  // --- getAuthHeaders ---

  it("getAuthHeaders() returns Authorization Bearer header for bearer auth when env var is set", () => {
    process.env["TEST_TOKEN_BEARER"] = "my-secret-token";
    try {
      const config = makeServerConfig("bearer-server", "bearer", "TEST_TOKEN_BEARER");
      injectFakeConnection(manager, "bearer-server", config, true);

      const headers = manager.getAuthHeaders("bearer-server");
      expect(headers).toEqual({ Authorization: "Bearer my-secret-token" });
    } finally {
      delete process.env["TEST_TOKEN_BEARER"];
    }
  });

  it("getAuthHeaders() returns empty object when auth type is none", () => {
    const config = makeServerConfig("none-server", "none");
    injectFakeConnection(manager, "none-server", config, true);

    const headers = manager.getAuthHeaders("none-server");
    expect(headers).toEqual({});
  });

  it("getAuthHeaders() returns empty object when bearer token env var is not set", () => {
    // Ensure the env var is absent
    delete process.env["MISSING_TOKEN"];
    const config = makeServerConfig("bearer-no-env", "bearer", "MISSING_TOKEN");
    injectFakeConnection(manager, "bearer-no-env", config, true);

    const headers = manager.getAuthHeaders("bearer-no-env");
    expect(headers).toEqual({});
  });

  it("getAuthHeaders() returns empty object for unknown server", () => {
    const headers = manager.getAuthHeaders("nonexistent");
    expect(headers).toEqual({});
  });

  it("getAuthHeaders() returns custom header for header auth type", () => {
    process.env["TEST_CUSTOM_TOKEN"] = "custom-value";
    try {
      const config: ServerConfig = {
        id: "header-server",
        name: "Header Server",
        transport: "stdio",
        command: "echo",
        args: [],
        auth: { type: "header", tokenEnv: "TEST_CUSTOM_TOKEN", headerName: "X-Api-Key" },
      };
      injectFakeConnection(manager, "header-server", config, true);

      const headers = manager.getAuthHeaders("header-server");
      expect(headers).toEqual({ "X-Api-Key": "custom-value" });
    } finally {
      delete process.env["TEST_CUSTOM_TOKEN"];
    }
  });

  // --- getServerStatus ---

  it("getServerStatus() returns empty array when no servers are connected", () => {
    const status = manager.getServerStatus();
    expect(status).toEqual([]);
  });

  it("getServerStatus() returns correct aggregation for mixed-health servers", () => {
    const configA = makeServerConfig("server-a", "none");
    const configB = makeServerConfig("server-b", "none");

    // Insert both servers into the DB so getAllServers() returns tool_count
    db.insertServer("server-a", "Server server-a", "stdio");
    db.insertServer("server-b", "Server server-b", "stdio");

    injectFakeConnection(manager, "server-a", configA, true);
    injectFakeConnection(manager, "server-b", configB, false);

    const status = manager.getServerStatus();

    expect(status).toHaveLength(2);

    const a = status.find((s) => s.id === "server-a");
    const b = status.find((s) => s.id === "server-b");

    expect(a).toBeDefined();
    expect(a!.healthy).toBe(true);
    expect(a!.name).toBe("Server server-a");
    expect(typeof a!.toolCount).toBe("number");

    expect(b).toBeDefined();
    expect(b!.healthy).toBe(false);
    expect(b!.name).toBe("Server server-b");
  });

  it("getServerStatus() shows correct tool count after tools are inserted", () => {
    const config = makeServerConfig("count-server", "none");
    db.insertServer("count-server", "Count Server", "stdio");

    // Insert 2 tools directly into the DB
    db.insertTool("count-server:tool_one", "count-server", "tool_one", "First tool", '{"type":"object"}');
    db.insertTool("count-server:tool_two", "count-server", "tool_two", "Second tool", '{"type":"object"}');
    db.updateServerSync("count-server", 2);

    injectFakeConnection(manager, "count-server", config, true);

    const status = manager.getServerStatus();
    const entry = status.find((s) => s.id === "count-server");

    expect(entry).toBeDefined();
    expect(entry!.toolCount).toBe(2);
  });
});
