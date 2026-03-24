import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { ToolRegistry } from "../src/tool-registry.js";
import { ToolStreamDatabase } from "../src/database.js";
import { EmbeddingEngine } from "../src/embedding-engine.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

function tmpDbPath(): string {
  const dir = join(tmpdir(), "toolstream-test");
  mkdirSync(dir, { recursive: true });
  return join(dir, `registry-${randomUUID()}.db`);
}

describe("ToolRegistry", () => {
  let engine: EmbeddingEngine;
  let db: ToolStreamDatabase;
  let registry: ToolRegistry;
  let dbPath: string;

  beforeAll(async () => {
    engine = new EmbeddingEngine("local");
    await engine.initialize();
  }, 60000);

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = new ToolStreamDatabase(dbPath);
    db.insertServer("fs", "Filesystem", "stdio");
    db.insertServer("github", "GitHub", "stdio");
    registry = new ToolRegistry(db, engine);
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it("registers tools and builds index", async () => {
    await registry.registerTools("fs", [
      { name: "read_file", description: "Read a file from disk", inputSchema: { type: "object" } },
      { name: "write_file", description: "Write content to a file", inputSchema: { type: "object" } },
    ]);

    expect(registry.indexSize).toBe(2);
  });

  it("topKByVector returns ranked results", async () => {
    await registry.registerTools("fs", [
      { name: "read_file", description: "Read a file from disk", inputSchema: { type: "object" } },
      { name: "write_file", description: "Write content to a file", inputSchema: { type: "object" } },
      { name: "list_dir", description: "List directory contents", inputSchema: { type: "object" } },
    ]);
    await registry.registerTools("github", [
      { name: "create_issue", description: "Create a GitHub issue", inputSchema: { type: "object" } },
      { name: "list_repos", description: "List GitHub repositories", inputSchema: { type: "object" } },
    ]);

    const queryVector = await engine.embed("read a file");
    const results = await registry.topKByVector(queryVector, 3);

    expect(results.length).toBeLessThanOrEqual(3);
    expect(results.length).toBeGreaterThan(0);

    // First result should be file-related
    expect(results[0].tool.toolName).toMatch(/file|read|dir/i);

    // Scores should be descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it("getToolById returns tool or null", async () => {
    await registry.registerTools("fs", [
      { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
    ]);

    const found = registry.getToolById("fs:read_file");
    expect(found).not.toBeNull();
    expect(found!.toolName).toBe("read_file");

    const notFound = registry.getToolById("fs:nonexistent");
    expect(notFound).toBeNull();
  });

  it("deactivateServerTools removes from results", async () => {
    await registry.registerTools("fs", [
      { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
    ]);

    registry.deactivateServerTools("fs");

    const queryVector = await engine.embed("read a file");
    const results = await registry.topKByVector(queryVector, 5);
    // Should not include deactivated tools
    const fsTools = results.filter((r) => r.tool.serverId === "fs");
    expect(fsTools).toHaveLength(0);
  });

  it("getAllServers returns server list", async () => {
    const servers = registry.getAllServers();
    expect(servers).toHaveLength(2);
    expect(servers.map((s) => s.id)).toContain("fs");
    expect(servers.map((s) => s.id)).toContain("github");
  });

  it("handles empty index gracefully", async () => {
    const queryVector = new Float32Array(384).fill(0);
    const results = await registry.topKByVector(queryVector, 5);
    expect(results).toHaveLength(0);
  });

  it("findClosestTool returns best match", async () => {
    await registry.registerTools("fs", [
      { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
      { name: "write_file", description: "Write a file", inputSchema: { type: "object" } },
    ]);

    const match = registry.findClosestTool("read_fil"); // typo
    expect(match).toBe("fs:read_file");
  });

  it("concurrent registerTools and topKByVector complete without error", async () => {
    // Pre-populate so topKByVector has something to iterate over
    await registry.registerTools("fs", [
      { name: "read_file", description: "Read a file from disk", inputSchema: { type: "object" } },
    ]);

    // Start a second registerTools and a topKByVector concurrently
    const queryVector = await engine.embed("write a file");
    const [, results] = await Promise.all([
      registry.registerTools("github", [
        { name: "create_issue", description: "Create a GitHub issue", inputSchema: { type: "object" } },
      ]),
      registry.topKByVector(queryVector, 5),
    ]);

    // Both should complete; results is a valid array
    expect(Array.isArray(results)).toBe(true);
    // After both settle the index should contain both servers' tools
    expect(registry.indexSize).toBe(2);
  });
});
