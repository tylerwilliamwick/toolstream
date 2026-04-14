// src/embedding-engine.ts - Embedding inference (local ONNX + OpenAI)

import { logger } from "./logger.js";

const LOCAL_VECTOR_DIM = 384;
const OPENAI_VECTOR_DIM = 1536; // text-embedding-3-small default

export class EmbeddingEngine {
  private extractor: any | null = null;
  private provider: "local" | "openai";
  private openaiApiKey: string | null = null;
  private openaiModel: string;
  private vectorDim: number;
  private localFallback: boolean = false;
  private degraded: boolean = false;

  constructor(
    provider: "local" | "openai" = "local",
    openaiApiKey?: string,
    openaiModel: string = "text-embedding-3-small"
  ) {
    this.provider = provider;
    this.openaiApiKey = openaiApiKey ?? process.env.OPENAI_API_KEY ?? null;
    this.openaiModel = openaiModel;
    this.vectorDim = provider === "openai" ? OPENAI_VECTOR_DIM : LOCAL_VECTOR_DIM;
  }

  async initialize(): Promise<void> {
    if (this.provider === "openai" && !this.openaiApiKey) {
      logger.warn("[EmbeddingEngine] OpenAI API key missing, falling back to local ONNX");
      this.provider = "local";
      this.vectorDim = LOCAL_VECTOR_DIM;
    }

    if (this.provider === "local" || this.localFallback) {
      await this.initializeLocal();
    }
  }

  private async initializeLocal(): Promise<void> {
    const { pipeline } = await import("@xenova/transformers");
    try {
      this.extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        { revision: "main" }
      );
      if (this.provider !== "openai") {
        this.vectorDim = LOCAL_VECTOR_DIM;
      }
      this.degraded = false;
    } catch (err) {
      this.degraded = true;
      this.extractor = null;
      logger.warn(
        `[EmbeddingEngine] ONNX init failed, entering degraded pass-through mode. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async embed(text: string): Promise<Float32Array> {
    if (this.degraded) {
      // Attempt re-init before giving up
      await this.initializeLocal();
      if (this.degraded) {
        throw new Error("[EmbeddingEngine] Degraded: ONNX unavailable, skipping embedding to prevent zero-vector persistence");
      }
    }

    if (this.provider === "openai") {
      try {
        return await this.embedOpenAI(text);
      } catch (err) {
        logger.warn(`[EmbeddingEngine] OpenAI embed failed, falling back to local: ${err instanceof Error ? err.message : String(err)}`);
        if (!this.extractor) {
          await this.initializeLocal();
          this.vectorDim = LOCAL_VECTOR_DIM;
        }
        return await this.embedLocal(text);
      }
    }

    return await this.embedLocal(text);
  }

  private async embedLocal(text: string): Promise<Float32Array> {
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
      logger.warn(`[EmbeddingEngine] embed() took ${elapsed}ms (SLA: 50ms)`);
    }
    return vector;
  }

  private async embedOpenAI(text: string): Promise<Float32Array> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.openaiModel,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return new Float32Array(data.data[0].embedding);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (this.degraded) {
      // Attempt re-init before giving up
      await this.initializeLocal();
      if (this.degraded) {
        throw new Error("[EmbeddingEngine] Degraded: ONNX unavailable, skipping batch embedding to prevent zero-vector persistence");
      }
    }

    if (this.provider === "openai") {
      try {
        return await this.embedBatchOpenAI(texts);
      } catch (err) {
        logger.warn(`[EmbeddingEngine] OpenAI batch embed failed, falling back to local: ${err instanceof Error ? err.message : String(err)}`);
        if (!this.extractor) {
          await this.initializeLocal();
          this.vectorDim = LOCAL_VECTOR_DIM;
        }
        return await this.embedBatchLocal(texts);
      }
    }

    return await this.embedBatchLocal(texts);
  }

  private async embedBatchLocal(texts: string[]): Promise<Float32Array[]> {
    if (!this.extractor) {
      throw new Error("EmbeddingEngine not initialized. Call initialize() first.");
    }

    const output = await this.extractor(texts, {
      pooling: "mean",
      normalize: true,
      batch_size: 32,
    });

    const results: Float32Array[] = [];
    const dim = LOCAL_VECTOR_DIM;
    for (let i = 0; i < texts.length; i++) {
      results.push(
        new Float32Array(output.data.slice(i * dim, (i + 1) * dim))
      );
    }
    return results;
  }

  private async embedBatchOpenAI(texts: string[]): Promise<Float32Array[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.openaiModel,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => new Float32Array(d.embedding));
  }

  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    const len = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
    }
    return dot; // vectors are L2-normalized, so dot product = cosine similarity
  }

  get vectorDimensions(): number {
    return this.vectorDim;
  }

  get modelId(): string {
    if (this.provider === "openai") {
      return `openai:${this.openaiModel}`;
    }
    return "local:all-MiniLM-L6-v2";
  }

  get activeProvider(): "local" | "openai" {
    return this.provider;
  }

  get isDegraded(): boolean {
    return this.degraded;
  }
}
