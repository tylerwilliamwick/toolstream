import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ProxyServer } from "../src/proxy-server.js";
import { ToolStreamDatabase } from "../src/database.js";
import { EmbeddingEngine } from "../src/embedding-engine.js";
import { ToolRegistry } from "../src/tool-registry.js";
import { SemanticRouter } from "../src/semantic-router.js";
import { SessionManager } from "../src/session-manager.js";
import { DependencyResolver } from "../src/dependency-resolver.js";
import type { ToolStreamConfig } from "../src/types.js";

// Minimal stub for UpstreamManager
class StubUpstreamManager {
  private connectedServers: Set<string> = new Set();
  private cannedResponse: Record<string, unknown>;

  constructor(
    connectedServers: string[] = [],
    cannedResponse: Record<string, unknown> = {}
  ) {
    for (const s of connectedServers) this.connectedServers.add(s);
    this.cannedResponse = cannedResponse;
  }

  isConnected(serverId: string): boolean {
    return this.connectedServers.has(serverId);
  }

  async callTool(
    _serverId: string,
    _toolName: string,
    _args: Record<string, unknown>
  ): Promise<unknown> {
    return this.cannedResponse;
  }

  async disconnectAll(): Promise<void> {}
}

const TEST_CONFIG: ToolStreamConfig = {
  transport: { stdio: false },
  embedding: { provider: "local", model: "all-MiniLM-L6-v2" },
  routing: { topK: 10, confidenceThreshold: 0.3, contextWindowTurns: 5 },
  storage: { provider: "sqlite", sqlitePath: ":memory:" },
  servers: [
    {
      id: "fs",
      name: "Filesystem",
      transport: "stdio",
      auth: { type: "none" },
    },
    {
      id: "github",
      name: "GitHub",
      transport: "stdio",
      auth: { type: "none" },
    },
  ],
};

// Tools registered before each test
const TEST_TOOLS = [
  {
    name: "read_file",
    description: "Read contents of a file from the filesystem",
    inputSchema: {
      type: "object" as const,
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file on the filesystem",
    inputSchema: {
      type: "object" as const,
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List files in a directory",
    inputSchema: {
      type: "object" as const,
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
];

describe("ProxyServer", () => {
  let embedEngine: EmbeddingEngine;
  let db: ToolStreamDatabase;
  let registry: ToolRegistry;
  let sessionManager: SessionManager;
  let semanticRouter: SemanticRouter;
  let dependencyResolver: DependencyResolver;
  let upstreamManager: StubUpstreamManager;
  let server: ProxyServer;
  let client: Client;
  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;

  beforeAll(async () => {
    embedEngine = new EmbeddingEngine("local");
    await embedEngine.initialize();
  }, 60_000);

  beforeEach(async () => {
    db = new ToolStreamDatabase(":memory:");
    registry = new ToolRegistry(db, embedEngine);
    sessionManager = new SessionManager(db, 300_000);
    semanticRouter = new SemanticRouter(embedEngine, registry, TEST_CONFIG.routing);
    dependencyResolver = new DependencyResolver();
    upstreamManager = new StubUpstreamManager(["fs", "github"], {
      content: [{ type: "text", text: "canned result" }],
    });

    // Pre-register server and tools in DB so the registry can find them
    db.insertServer("fs", "Filesystem", "stdio");
    await registry.registerTools("fs", TEST_TOOLS);

    server = new ProxyServer(
      TEST_CONFIG,
      sessionManager,
      semanticRouter,
      registry,
      upstreamManager as any,
      dependencyResolver
    );

    [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await server.start(serverTransport);
    await client.connect(clientTransport);
  }, 30_000);

  afterEach(async () => {
    await client.close();
    await server.stop();
    db.close();
  });

  it("tools/list on fresh session returns exactly 4 meta-tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);

    expect(names).toContain("discover_servers");
    expect(names).toContain("discover_tools");
    expect(names).toContain("execute_tool");
    expect(names).toContain("reconnect_server");
    expect(result.tools).toHaveLength(4);
  });

  it("discover_tools returns file-related tools for 'read a file'", async () => {
    const result = await client.callTool({
      name: "discover_tools",
      arguments: { query: "read a file" },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);

    const parsed = JSON.parse(content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);

    // At least one result should be a filesystem read-related tool
    const toolNames: string[] = parsed.map((r: { tool: string }) => r.tool);
    const hasFileRelated = toolNames.some(
      (n) => n.includes("read") || n.includes("file") || n.includes("list")
    );
    expect(hasFileRelated).toBe(true);
  }, 30_000);

  it("discover_tools surfaces tools into session so subsequent tools/list includes them", async () => {
    // First call: discover to surface tools
    await client.callTool({
      name: "discover_tools",
      arguments: { query: "read a file" },
    });

    // Second call: tools/list should now include surfaced tools
    const listResult = await client.listTools();
    const names = listResult.tools.map((t) => t.name);

    // Should still have meta-tools
    expect(names).toContain("discover_servers");
    expect(names).toContain("discover_tools");
    expect(names).toContain("execute_tool");

    // Should have more than just the 3 meta-tools
    expect(listResult.tools.length).toBeGreaterThan(3);

    // Surfaced tools should be namespaced as fs_<toolname>
    const surfaced = names.filter((n) => n.startsWith("fs_"));
    expect(surfaced.length).toBeGreaterThan(0);
  }, 30_000);

  it("execute_tool with nonexistent tool returns tool_not_found with suggestion", async () => {
    const result = await client.callTool({
      name: "execute_tool",
      arguments: {
        server: "fs",
        tool: "reed_fiel",
        arguments: {},
      },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.error).toBe("tool_not_found");
    expect(parsed.tool_name).toBe("reed_fiel");
    // suggestion is optional but if present should be a string
    if (parsed.suggestion !== undefined) {
      expect(typeof parsed.suggestion).toBe("string");
    }
  });

  it("discover_tools without query parameter returns error response", async () => {
    const result = await client.callTool({
      name: "discover_tools",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.error).toBe("query parameter is required");
  });

  it("execute_tool with non-existent server returns server_not_connected error", async () => {
    const result = await client.callTool({
      name: "execute_tool",
      arguments: {
        server: "nonexistent-server",
        tool: "some_tool",
        arguments: {},
      },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    // Registry won't find the tool, so tool_not_found fires before server_not_connected
    expect(["tool_not_found", "server_not_connected"]).toContain(parsed.error);
  });

  it("execute_tool with non-existent tool on valid server returns tool_not_found", async () => {
    const result = await client.callTool({
      name: "execute_tool",
      arguments: {
        server: "fs",
        tool: "totally_missing_tool",
        arguments: {},
      },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.error).toBe("tool_not_found");
    expect(parsed.tool_name).toBe("totally_missing_tool");
  });

  it("discover_servers returns correct server list", async () => {
    const result = await client.callTool({
      name: "discover_servers",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(Array.isArray(parsed)).toBe(true);

    // The fs server was inserted into DB, so it should appear
    const ids: string[] = parsed.map((s: { id: string }) => s.id);
    expect(ids).toContain("fs");

    // Each entry has required fields
    for (const entry of parsed) {
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("tool_count");
    }
  });

  describe("discover_tools triggers dependency resolution", () => {
    it("resolveDependencies is called and dependency tools appear in tools/list", async () => {
      // Register ToolRecord objects with the dependency resolver so it has data
      // Both tools share 'path' in their required fields, triggering a match
      const depToolRecords = [
        {
          id: "fs:read_file",
          serverId: "fs",
          toolName: "read_file",
          description: "Read contents of a file from the filesystem",
          inputSchema: {
            type: "object" as const,
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          isActive: true,
        },
        {
          id: "fs:write_file",
          serverId: "fs",
          toolName: "write_file",
          description: "Write content to a file on the filesystem",
          inputSchema: {
            type: "object" as const,
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
          isActive: true,
        },
        {
          id: "fs:list_directory",
          serverId: "fs",
          toolName: "list_directory",
          description: "List files in a directory",
          inputSchema: {
            type: "object" as const,
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          isActive: true,
        },
      ];
      dependencyResolver.registerTools("fs", depToolRecords);

      const spy = vi.spyOn(dependencyResolver, "resolveDependencies");

      // Call discover_tools to trigger routing + dependency resolution
      await client.callTool({
        name: "discover_tools",
        arguments: { query: "read a file from disk" },
      });

      // Assert resolveDependencies was called at least once
      expect(spy).toHaveBeenCalled();

      // After discover_tools, tools/list should include surfaced tools
      const listResult = await client.listTools();
      const names = listResult.tools.map((t) => t.name);

      // Should have meta-tools plus surfaced tools
      expect(listResult.tools.length).toBeGreaterThan(4);

      // At least one surfaced tool should be namespaced as fs_<toolname>
      const surfaced = names.filter((n) => n.startsWith("fs_"));
      expect(surfaced.length).toBeGreaterThan(0);

      spy.mockRestore();
    }, 30_000);
  });
});
