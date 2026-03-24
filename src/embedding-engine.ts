// src/embedding-engine.ts - Local ONNX embedding inference

const VECTOR_DIM = 384;

export class EmbeddingEngine {
  private extractor: any | null = null;
  private provider: "local" | "openai";

  constructor(provider: "local" | "openai" = "local") {
    this.provider = provider;
  }

  async initialize(): Promise<void> {
    if (this.provider === "local") {
      // Dynamic import to avoid issues when module is not available
      const { pipeline } = await import("@xenova/transformers");
      try {
        this.extractor = await pipeline(
          "feature-extraction",
          "Xenova/all-MiniLM-L6-v2",
          { revision: "main" }
        );
      } catch (err) {
        throw new Error(
          `Failed to initialize embedding model 'all-MiniLM-L6-v2'. ` +
          `If this is your first run, ensure you have an internet connection for the initial model download (~90MB). ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) {
      throw new Error("EmbeddingEngine not initialized. Call initialize() first.");
    }

    const start = Date.now();
    const output = await this.extractor(text, {
      pooling: "mean",
      normalize: true,
    });

    const vector = new Float32Array(output.data);
    const elapsed = Date.now() - start;
    if (elapsed > 50) {
      console.warn(`[EmbeddingEngine] embed() took ${elapsed}ms (SLA: 50ms)`);
    }
    return vector;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.extractor) {
      throw new Error("EmbeddingEngine not initialized. Call initialize() first.");
    }

    const output = await this.extractor(texts, {
      pooling: "mean",
      normalize: true,
      batch_size: 32,
    });

    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(
        new Float32Array(
          output.data.slice(i * VECTOR_DIM, (i + 1) * VECTOR_DIM)
        )
      );
    }
    return results;
  }

  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot; // vectors are L2-normalized, so dot product = cosine similarity
  }

  get vectorDimensions(): number {
    return VECTOR_DIM;
  }
}
