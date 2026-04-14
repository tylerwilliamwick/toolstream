// src/tool-registry.ts - Tool registry with in-memory vector search

import type { ToolStreamDatabase } from "./database.js";
import type { EmbeddingEngine } from "./embedding-engine.js";
import type { ToolRecord, ScoredTool, ServerRecord } from "./types.js";

const FALLBACK_SCHEMA = { type: "object", properties: {} };

function parseInputSchema(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return FALLBACK_SCHEMA;
  }
}

export class ToolRegistry {
  private db: ToolStreamDatabase;
  private embedEngine: EmbeddingEngine;
  private modelId: string;

  // In-memory vector index: toolId -> Float32Array
  private vectorIndex: Map<string, Float32Array> = new Map();

  // Simple promise-based write lock to guard vectorIndex mutations
  private writeLock: Promise<void> = Promise.resolve();
  private writeResolver: (() => void) | null = null;

  private async acquireWriteLock(): Promise<void> {
    await this.writeLock;
    this.writeLock = new Promise(resolve => {
      this.writeResolver = resolve;
    });
  }

  private releaseWriteLock(): void {
    if (this.writeResolver) {
      this.writeResolver();
      this.writeResolver = null;
    }
  }

  constructor(
    db: ToolStreamDatabase,
    embedEngine: EmbeddingEngine,
    modelId: string = "all-MiniLM-L6-v2"
  ) {
    this.db = db;
    this.embedEngine = embedEngine;
    this.modelId = modelId;
  }

  async loadIndex(): Promise<void> {
    const embeddings = this.db.getAllEmbeddings();
    for (const emb of embeddings) {
      const vector = new Float32Array(
        emb.vector.buffer,
        emb.vector.byteOffset,
        emb.vector.byteLength / 4
      );
      this.vectorIndex.set(emb.tool_id, vector);
    }
    console.log(
      `[ToolRegistry] Loaded ${this.vectorIndex.size} embeddings into memory`
    );
  }

  async registerTools(
    serverId: string,
    tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }>
  ): Promise<void> {
    const descriptions: string[] = [];
    const toolIds: string[] = [];

    for (const tool of tools) {
      const toolId = `${serverId}:${tool.name}`;
      this.db.insertTool(
        toolId,
        serverId,
        tool.name,
        tool.description || tool.name,
        JSON.stringify(tool.inputSchema)
      );
      descriptions.push(
        `${tool.name}: ${tool.description || tool.name}`
      );
      toolIds.push(toolId);
    }

    // Generate embeddings only for tools that don't have them yet
    if (descriptions.length > 0) {
      // Filter to only tools that need new embeddings
      const needsEmbedding: { desc: string; id: string }[] = [];
      for (let i = 0; i < toolIds.length; i++) {
        const existing = this.db.getEmbedding(toolIds[i]);
        if (!existing) {
          needsEmbedding.push({ desc: descriptions[i], id: toolIds[i] });
        } else {
          // Load existing embedding into memory index
          const vector = new Float32Array(existing.vector.buffer, existing.vector.byteOffset, existing.vector.byteLength / 4);
          this.vectorIndex.set(toolIds[i], vector);
        }
      }

      if (needsEmbedding.length > 0) {
        await this.acquireWriteLock();
        try {
          const vectors = await this.embedEngine.embedBatch(needsEmbedding.map(t => t.desc));
          for (let i = 0; i < needsEmbedding.length; i++) {
            const buffer = Buffer.from(vectors[i].buffer);
            this.db.insertEmbedding(needsEmbedding[i].id, buffer, this.modelId);
            this.vectorIndex.set(needsEmbedding[i].id, vectors[i]);
          }
        } finally {
          this.releaseWriteLock();
        }
      }
    }

    this.db.updateServerSync(serverId, tools.length);
    console.log(
      `[ToolRegistry] Registered ${tools.length} tools from server '${serverId}'`
    );
  }

  clearVectorIndex(): void {
    this.vectorIndex.clear();
  }

  async topKByVector(queryVector: Float32Array, k: number): Promise<ScoredTool[]> {
    await this.writeLock; // Wait for any pending write to finish
    const scores: Array<{ toolId: string; score: number }> = [];

    for (const [toolId, vector] of this.vectorIndex) {
      // Dimension guard: skip vectors with mismatched dimensions
      if (vector.length !== queryVector.length) continue;
      const score = this.embedEngine.cosineSimilarity(queryVector, vector);
      scores.push({ toolId, score });
    }

    scores.sort((a, b) => b.score - a.score);
    const topK = scores.slice(0, k);

    const results: ScoredTool[] = [];
    for (const { toolId, score } of topK) {
      const row = this.db.getToolById(toolId);
      if (!row || row.is_active === 0) continue;

      results.push({
        tool: {
          id: row.id,
          serverId: row.server_id,
          toolName: row.tool_name,
          description: row.description,
          inputSchema: parseInputSchema(row.input_schema),
          isActive: row.is_active === 1,
        },
        score,
        source: "semantic",
      });
    }
    return results;
  }


  getToolById(id: string): ToolRecord | null {
    const row = this.db.getToolById(id);
    if (!row) return null;
    return {
      id: row.id,
      serverId: row.server_id,
      toolName: row.tool_name,
      description: row.description,
      inputSchema: parseInputSchema(row.input_schema),
      isActive: row.is_active === 1,
    };
  }

  getToolByServerAndName(serverId: string, toolName: string): ToolRecord | null {
    return this.getToolById(`${serverId}:${toolName}`);
  }

  getAllServers(): ServerRecord[] {
    return this.db.getAllServers().map((row) => ({
      id: row.id,
      displayName: row.display_name,
      transportType: row.transport_type,
      lastSyncedAt: row.last_synced_at,
      toolCount: row.tool_count,
    }));
  }

  getAllActiveTools(): ToolRecord[] {
    return this.db.getAllActiveTools().map((row) => ({
      id: row.id,
      serverId: row.server_id,
      toolName: row.tool_name,
      description: row.description,
      inputSchema: parseInputSchema(row.input_schema),
      isActive: true,
    }));
  }

  deactivateServerTools(serverId: string): void {
    this.db.deactivateServerTools(serverId);
    // Remove from vector index
    for (const [toolId] of this.vectorIndex) {
      if (toolId.startsWith(`${serverId}:`)) {
        this.vectorIndex.delete(toolId);
      }
    }
  }

  findClosestTool(name: string): string | null {
    const allTools = this.getAllActiveTools();
    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const tool of allTools) {
      const score = similarityScore(name.toLowerCase(), tool.toolName.toLowerCase());
      if (score > bestScore) {
        bestScore = score;
        bestMatch = tool.id;
      }
    }
    return bestMatch;
  }

  get indexSize(): number {
    return this.vectorIndex.size;
  }
}

function similarityScore(a: string, b: string): number {
  // Simple Jaccard similarity on character bigrams
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  const union = bigramsA.size + bigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
