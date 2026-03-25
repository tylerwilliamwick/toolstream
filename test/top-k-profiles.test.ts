import { describe, it, expect, beforeAll } from "vitest";
import { SemanticRouter } from "../src/semantic-router.js";
import { EmbeddingEngine } from "../src/embedding-engine.js";
import { ToolRegistry } from "../src/tool-registry.js";
import { ToolStreamDatabase } from "../src/database.js";
import type { ServerConfig } from "../src/types.js";

describe("Configurable Top-K Profiles (7d)", () => {
  let embedEngine: EmbeddingEngine;
  let db: ToolStreamDatabase;
  let registry: ToolRegistry;

  beforeAll(async () => {
    embedEngine = new EmbeddingEngine("local");
    await embedEngine.initialize();
    db = new ToolStreamDatabase(":memory:");
    registry = new ToolRegistry(db, embedEngine);
  }, 60_000);

  it("server with top_k: 8 returns value from getTopKForServer", () => {
    const servers: ServerConfig[] = [
      { id: "atlassian", name: "Atlassian", transport: "stdio", auth: { type: "none" }, routing: { topK: 8 } },
      { id: "github", name: "GitHub", transport: "stdio", auth: { type: "none" } },
    ];

    const router = new SemanticRouter(embedEngine, registry, {
      topK: 5,
      confidenceThreshold: 0.3,
      contextWindowTurns: 3,
    }, servers);

    expect(router.getTopKForServer("atlassian")).toBe(8);
  });

  it("server without top_k falls back to global", () => {
    const servers: ServerConfig[] = [
      { id: "github", name: "GitHub", transport: "stdio", auth: { type: "none" } },
    ];

    const router = new SemanticRouter(embedEngine, registry, {
      topK: 5,
      confidenceThreshold: 0.3,
      contextWindowTurns: 3,
    }, servers);

    expect(router.getTopKForServer("github")).toBe(5);
  });

  it("unknown server falls back to global", () => {
    const router = new SemanticRouter(embedEngine, registry, {
      topK: 5,
      confidenceThreshold: 0.3,
      contextWindowTurns: 3,
    }, []);

    expect(router.getTopKForServer("nonexistent")).toBe(5);
  });
});
