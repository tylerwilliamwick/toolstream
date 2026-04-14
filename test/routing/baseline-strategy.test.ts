import { describe, it, expect, beforeAll } from "vitest";
import { ToolStreamDatabase } from "../../src/database.js";
import { EmbeddingEngine } from "../../src/embedding-engine.js";
import { ToolRegistry } from "../../src/tool-registry.js";
import { BaselineStrategy } from "../../src/routing/baseline-strategy.js";
import { SemanticRouter } from "../../src/semantic-router.js";

describe("BaselineStrategy byte-identical non-regression", () => {
  let engine: EmbeddingEngine;
  let db: ToolStreamDatabase;
  let registry: ToolRegistry;

  beforeAll(async () => {
    engine = new EmbeddingEngine("local");
    await engine.initialize();
    db = new ToolStreamDatabase(":memory:");
    db.insertServer("fs", "Filesystem", "stdio");
    db.insertServer("gh", "GitHub", "stdio");
    registry = new ToolRegistry(db, engine);
    await registry.registerTools("fs", [
      { name: "read_file", description: "Read a file", inputSchema: { type: "object", properties: {} } },
      { name: "write_file", description: "Write a file", inputSchema: { type: "object", properties: {} } },
    ]);
    await registry.registerTools("gh", [
      { name: "create_issue", description: "Create a GitHub issue", inputSchema: { type: "object", properties: {} } },
      { name: "list_repos", description: "List GitHub repos", inputSchema: { type: "object", properties: {} } },
    ]);
  }, 60000);

  it("baseline.route() produces same candidates as SemanticRouter.route() for 10 fixed inputs", async () => {
    const router = new SemanticRouter(
      engine,
      registry,
      { topK: 5, confidenceThreshold: 0.2, contextWindowTurns: 3 },
    );

    const baseline = new BaselineStrategy({
      engine,
      registry,
      topK: 5,
      threshold: 0.2,
      contextWindowTurns: 3,
      serverTopK: new Map(),
    });

    const fixtures = [
      ["read a file"],
      ["create GitHub issue"],
      ["list files in dir", "read a file"],
      ["write content to disk"],
      ["open pull request"],
      [""],
      ["list my repositories"],
      ["delete a file from disk"],
      ["search for github code"],
      ["turn 1", "turn 2", "turn 3", "turn 4"],
    ];

    for (const ctx of fixtures) {
      const routerResult = await router.route(ctx);
      const baseResult = await baseline.route({
        sessionId: "sess-fixture",
        contextBuffer: ctx,
      });
      const routerIds = routerResult.candidates.map((c) => c.tool.id);
      const baseIds = baseResult.candidates.map((c) => c.tool.id);
      expect(baseIds).toEqual(routerIds);
      expect(baseResult.belowThreshold).toBe(routerResult.belowThreshold);
    }
  });

  it("emits a RouteTrace with strategy_id 'baseline' and correct shape", async () => {
    const baseline = new BaselineStrategy({
      engine,
      registry,
      topK: 5,
      threshold: 0.2,
      contextWindowTurns: 3,
      serverTopK: new Map(),
    });

    const result = await baseline.route({
      sessionId: "sess-1",
      contextBuffer: ["read a file"],
    });

    expect(result.trace.strategyId).toBe("baseline");
    expect(result.trace.sessionId).toBe("sess-1");
    expect(result.trace.queryText).toContain("read a file");
    expect(result.trace.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.trace.surfacedToolIds.length).toBe(result.candidates.length);
  });

  it("applies topic bias 1.3x to dominant server candidates", async () => {
    const baseline = new BaselineStrategy({
      engine,
      registry,
      topK: 5,
      threshold: 0.0,
      contextWindowTurns: 3,
      serverTopK: new Map(),
    });

    const result = await baseline.route({
      sessionId: "sess-topic",
      contextBuffer: ["read a file"],
      sessionContext: { dominantServerId: "gh", confidence: 0.9 },
    });

    const ghCandidate = result.trace.candidates.find((c) => c.toolId.startsWith("gh:"));
    if (ghCandidate) {
      expect(ghCandidate.boosts).toHaveProperty("topic_bias");
      expect(ghCandidate.boosts.topic_bias).toBe(1.3);
    }
  });
});
