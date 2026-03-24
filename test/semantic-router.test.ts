import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { SemanticRouter } from "../src/semantic-router.js";
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
  return join(dir, `router-${randomUUID()}.db`);
}

describe("SemanticRouter", () => {
  let engine: EmbeddingEngine;
  let db: ToolStreamDatabase;
  let registry: ToolRegistry;
  let router: SemanticRouter;
  let dbPath: string;

  beforeAll(async () => {
    engine = new EmbeddingEngine("local");
    await engine.initialize();
  }, 60000);

  beforeEach(async () => {
    dbPath = tmpDbPath();
    db = new ToolStreamDatabase(dbPath);
    db.insertServer("fs", "Filesystem", "stdio");
    db.insertServer("github", "GitHub", "stdio");
    registry = new ToolRegistry(db, engine);

    await registry.registerTools("fs", [
      { name: "read_file", description: "Read a file from disk", inputSchema: { type: "object" } },
      { name: "write_file", description: "Write data to a file", inputSchema: { type: "object" } },
    ]);
    await registry.registerTools("github", [
      { name: "create_issue", description: "Create a new GitHub issue", inputSchema: { type: "object" } },
    ]);

    router = new SemanticRouter(engine, registry, {
      topK: 5,
      confidenceThreshold: 0.3,
      contextWindowTurns: 3,
    });
  });

  afterEach(() => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it("returns empty for empty context", async () => {
    const result = await router.route([]);
    expect(result.candidates).toHaveLength(0);
    expect(result.belowThreshold).toBe(true);
  });

  it("returns empty for blank context", async () => {
    const result = await router.route(["", "   "]);
    expect(result.belowThreshold).toBe(true);
  });

  it("routes file-related context to file tools", async () => {
    const result = await router.route(["I need to read a file from the disk"]);
    expect(result.candidates.length).toBeGreaterThan(0);

    const toolNames = result.candidates.map((c) => c.tool.toolName);
    expect(toolNames.some((n) => n.includes("file"))).toBe(true);
  });

  it("uses context window (last N turns)", async () => {
    // With contextWindowTurns=3, only last 3 should matter
    const buffer = [
      "old irrelevant context about databases",
      "more old context about email",
      "I want to read a file",
      "specifically from the filesystem",
      "please read the file now",
    ];
    const result = await router.route(buffer);
    // Should route to file tools based on last 3 turns
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it("search returns results without threshold filtering", async () => {
    const results = await router.search("create a GitHub issue", 10);
    expect(results.length).toBeGreaterThan(0);

    // Should find the GitHub tool
    const githubTool = results.find((r) => r.tool.toolName === "create_issue");
    expect(githubTool).toBeDefined();
  });

  it("sets belowThreshold when no candidates pass", async () => {
    // Create router with very high threshold
    const strictRouter = new SemanticRouter(engine, registry, {
      topK: 5,
      confidenceThreshold: 0.99, // Almost impossible to pass
      contextWindowTurns: 3,
    });

    const result = await strictRouter.route(["random unrelated text about cooking"]);
    expect(result.belowThreshold).toBe(true);
  });
});
