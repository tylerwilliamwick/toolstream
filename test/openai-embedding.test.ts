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

  it("falls back to local provider when OPENAI_API_KEY env var is absent at construction", () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    // Constructing with openai and no key supplied: should reflect local after initialize
    const engine = new EmbeddingEngine("openai");
    // Before initialize(), provider is still "openai" but will fall back
    expect(engine.activeProvider).toBe("openai");
    // vectorDimensions reports openai dimension before init
    expect(engine.vectorDimensions).toBe(1536);

    if (saved) process.env.OPENAI_API_KEY = saved;
  });

  it("dimension mismatch: 1536-dim query against 384-dim indexed tools returns empty", async () => {
    const engine = new EmbeddingEngine("local");
    await engine.initialize();

    const db = new ToolStreamDatabase(":memory:");
    const registry = new ToolRegistry(db, engine);

    db.insertServer("gh", "GitHub", "stdio");
    await registry.registerTools("gh", [
      { name: "list_issues", description: "List GitHub issues", inputSchema: { type: "object" } },
    ]);

    // Simulate a 1536-dim OpenAI vector queried against 384-dim local index
    const openAiVector = new Float32Array(1536).fill(0);
    openAiVector[0] = 1.0;

    const results = await registry.topKByVector(openAiVector, 5);
    expect(results).toHaveLength(0);

    db.close();
  }, 60_000);

  it("cosine similarity between identical unit vectors is 1.0", () => {
    const engine = new EmbeddingEngine("local");
    const a = new Float32Array(4).fill(0.5);
    const b = new Float32Array(4).fill(0.5);
    const sim = engine.cosineSimilarity(a, b);
    // dot product of two identical 0.5 vectors of length 4 = 4 * 0.25 = 1.0
    expect(sim).toBeCloseTo(1.0, 5);
  });
});
