import { describe, it, expect, beforeAll } from "vitest";
import { EmbeddingEngine } from "../src/embedding-engine.js";

describe("EmbeddingEngine", () => {
  let engine: EmbeddingEngine;

  beforeAll(async () => {
    engine = new EmbeddingEngine("local");
    await engine.initialize();
  }, 60000); // model download can take a while

  it("throws if not initialized", async () => {
    const uninitialized = new EmbeddingEngine("local");
    await expect(uninitialized.embed("test")).rejects.toThrow("not initialized");
  });

  it("embed returns 384-dim vector", async () => {
    const vector = await engine.embed("read a file from disk");
    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector.length).toBe(384);
  });

  it("embedBatch returns array of 384-dim vectors", async () => {
    const vectors = await engine.embedBatch([
      "read a file",
      "create an issue",
      "run a query",
    ]);
    expect(vectors).toHaveLength(3);
    for (const v of vectors) {
      expect(v).toBeInstanceOf(Float32Array);
      expect(v.length).toBe(384);
    }
  });

  it("batch embed matches single embed", async () => {
    const text = "search for code in repository";
    const single = await engine.embed(text);
    const batch = await engine.embedBatch([text]);

    // Should be very close (floating point tolerance)
    for (let i = 0; i < 384; i++) {
      expect(Math.abs(single[i] - batch[0][i])).toBeLessThan(0.001);
    }
  });

  it("cosineSimilarity returns correct value for identical vectors", () => {
    const v = new Float32Array(384);
    // Create a normalized vector
    const val = 1 / Math.sqrt(384);
    v.fill(val);

    const sim = engine.cosineSimilarity(v, v);
    expect(sim).toBeCloseTo(1.0, 3);
  });

  it("cosineSimilarity returns ~0 for orthogonal vectors", () => {
    const a = new Float32Array(384).fill(0);
    const b = new Float32Array(384).fill(0);
    a[0] = 1;
    b[1] = 1;

    const sim = engine.cosineSimilarity(a, b);
    expect(sim).toBeCloseTo(0, 3);
  });

  it("similar texts have higher similarity than dissimilar", async () => {
    const fileRead = await engine.embed("read a file from disk");
    const fileWrite = await engine.embed("write data to a file");
    const createIssue = await engine.embed("create a GitHub issue with labels");

    const simSame = engine.cosineSimilarity(fileRead, fileWrite);
    const simDiff = engine.cosineSimilarity(fileRead, createIssue);

    expect(simSame).toBeGreaterThan(simDiff);
  });

  it("vectorDimensions returns 384", () => {
    expect(engine.vectorDimensions).toBe(384);
  });
});
