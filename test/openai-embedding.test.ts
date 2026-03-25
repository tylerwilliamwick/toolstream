import { describe, it, expect } from "vitest";
import { EmbeddingEngine } from "../src/embedding-engine.js";
import { ToolStreamDatabase } from "../src/database.js";
import { ToolRegistry } from "../src/tool-registry.js";

describe("OpenAI Embedding Support (7e)", () => {
  it("config accepts provider: openai", () => {
    const engine = new EmbeddingEngine("openai", "fake-key", "text-embedding-3-small");
    expect(engine.activeProvider).toBe("openai");
    expect(engine.modelId).toBe("openai:text-embedding-3-small");
    expect(engine.vectorDimensions).toBe(1536);
  });

  it("missing API key falls back to local with warning", async () => {
    // Save and clear env
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const engine = new EmbeddingEngine("openai");
    await engine.initialize();
    expect(engine.activeProvider).toBe("local");
    expect(engine.vectorDimensions).toBe(384);

    // Restore
    if (saved) process.env.OPENAI_API_KEY = saved;
  }, 60_000);

  it("dimension guard in topKByVector rejects mismatched vectors", async () => {
    const engine = new EmbeddingEngine("local");
    await engine.initialize();

    const db = new ToolStreamDatabase(":memory:");
    const registry = new ToolRegistry(db, engine);

    // Register a tool (384-dim)
    db.insertServer("fs", "Filesystem", "stdio");
    await registry.registerTools("fs", [
      { name: "read", description: "Read a file", inputSchema: { type: "object" } },
    ]);

    // Create a mismatched query vector (1536-dim like OpenAI)
    const mismatchedQuery = new Float32Array(1536);
    mismatchedQuery[0] = 1.0;

    const results = await registry.topKByVector(mismatchedQuery, 5);
    // Should return empty since all stored vectors are 384-dim
    expect(results).toHaveLength(0);

    db.close();
  }, 60_000);

  it("clearEmbeddings + clearVectorIndex clears all data", async () => {
    const engine = new EmbeddingEngine("local");
    await engine.initialize();

    const db = new ToolStreamDatabase(":memory:");
    const registry = new ToolRegistry(db, engine);

    db.insertServer("fs", "Filesystem", "stdio");
    await registry.registerTools("fs", [
      { name: "read", description: "Read a file", inputSchema: { type: "object" } },
    ]);

    expect(db.getAllEmbeddings().length).toBe(1);
    expect(registry.indexSize).toBe(1);

    db.clearEmbeddings();
    registry.clearVectorIndex();

    expect(db.getAllEmbeddings().length).toBe(0);
    expect(registry.indexSize).toBe(0);

    db.close();
  }, 60_000);

  it("local provider reports correct modelId", () => {
    const engine = new EmbeddingEngine("local");
    expect(engine.modelId).toBe("local:all-MiniLM-L6-v2");
  });
});
