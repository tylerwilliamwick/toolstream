#!/usr/bin/env tsx
// scripts/benchmark.ts - Synthetic token savings benchmark
//
// Simulates tool schema loading at various scale points and compares
// the token cost of loading all schemas vs using ToolStream's meta-tools.

import { META_TOOL_SCHEMAS } from "../src/meta-tools.js";

// Fixed seed PRNG (Mulberry32) for deterministic output across runs
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rough tokenizer: ~4 chars per token (matches README methodology)
function estimateTokens(schema: object): number {
  return Math.ceil(JSON.stringify(schema).length / 4);
}

// Generate a realistic-looking tool schema
function generateToolSchema(rng: () => number, index: number) {
  const domains = [
    "file", "git", "issue", "page", "user", "project", "search",
    "build", "deploy", "database", "config", "log", "metric", "alert",
    "queue", "cache", "auth", "webhook", "notification", "workflow",
  ];
  const actions = [
    "create", "read", "update", "delete", "list", "search", "sync",
    "validate", "export", "import", "archive", "restore", "clone", "merge",
  ];

  const domain = domains[Math.floor(rng() * domains.length)];
  const action = actions[Math.floor(rng() * actions.length)];
  const name = `${action}_${domain}_${index}`;

  // Generate 2-6 properties per schema
  const propCount = 2 + Math.floor(rng() * 5);
  const properties: Record<string, object> = {};
  const required: string[] = [];

  const propNames = [
    "id", "name", "path", "query", "filter", "limit", "offset",
    "content", "title", "description", "status", "priority", "assignee",
    "labels", "format", "recursive", "force", "dry_run", "verbose",
  ];

  for (let p = 0; p < propCount; p++) {
    const propName = propNames[Math.floor(rng() * propNames.length)];
    if (properties[propName]) continue;
    properties[propName] = {
      type: rng() > 0.3 ? "string" : rng() > 0.5 ? "number" : "boolean",
      description: `The ${propName} parameter for ${action} ${domain} operation`,
    };
    if (rng() > 0.5) required.push(propName);
  }

  return {
    name,
    description: `${action.charAt(0).toUpperCase() + action.slice(1)} a ${domain} resource. Supports filtering, pagination, and batch operations for ${domain} management workflows.`,
    inputSchema: {
      type: "object" as const,
      properties,
      required,
    },
  };
}

function runBenchmark() {
  const toolCounts = [50, 100, 200];
  const topK = 5;

  // Measure meta-tool tokens (constant regardless of tool count)
  const metaToolTokens = META_TOOL_SCHEMAS.reduce(
    (sum, schema) => sum + estimateTokens(schema),
    0
  );
  // ToolStream surfaces topK tools per turn in addition to meta-tools
  // Use average tool size from the 100-tool set as representative
  const rng100 = mulberry32(42);
  const sample100 = Array.from({ length: 100 }, (_, i) =>
    generateToolSchema(rng100, i)
  );
  const avgToolTokens = Math.round(
    sample100.reduce((sum, t) => sum + estimateTokens(t), 0) / sample100.length
  );
  const surfacedTokens = topK * avgToolTokens;

  console.log("ToolStream Token Savings Benchmark");
  console.log("==================================\n");
  console.log(`Meta-tools: ${META_TOOL_SCHEMAS.length} tools, ${metaToolTokens} tokens`);
  console.log(`Surfaced per turn: top-${topK} tools (~${surfacedTokens} tokens)`);
  console.log(`ToolStream per turn: ${metaToolTokens + surfacedTokens} tokens\n`);

  // Table header
  const header = [
    "Tools".padStart(6),
    "All Schemas".padStart(13),
    "ToolStream".padStart(12),
    "Saved".padStart(12),
    "Reduction".padStart(11),
  ].join(" | ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const count of toolCounts) {
    const rng = mulberry32(42); // Same seed every time for determinism
    const tools = Array.from({ length: count }, (_, i) =>
      generateToolSchema(rng, i)
    );

    const allTokens = tools.reduce((sum, t) => sum + estimateTokens(t), 0);
    const tsTokens = metaToolTokens + surfacedTokens;
    const saved = allTokens - tsTokens;
    const reduction = ((saved / allTokens) * 100).toFixed(1);

    console.log(
      [
        String(count).padStart(6),
        String(allTokens).padStart(13),
        String(tsTokens).padStart(12),
        String(saved).padStart(12),
        `${reduction}%`.padStart(11),
      ].join(" | ")
    );
  }

  console.log("\n10-turn conversation cost (at $15/M input tokens, Opus):\n");

  const costHeader = [
    "Tools".padStart(6),
    "Without TS".padStart(12),
    "With TS".padStart(12),
    "Saved".padStart(12),
  ].join(" | ");

  console.log(costHeader);
  console.log("-".repeat(costHeader.length));

  for (const count of toolCounts) {
    const rng = mulberry32(42);
    const tools = Array.from({ length: count }, (_, i) =>
      generateToolSchema(rng, i)
    );

    const allTokens = tools.reduce((sum, t) => sum + estimateTokens(t), 0);
    const tsTokens = metaToolTokens + surfacedTokens;

    const turns = 10;
    const costWithout = ((allTokens * turns) / 1_000_000) * 15;
    const costWith = ((tsTokens * turns) / 1_000_000) * 15;
    const costSaved = costWithout - costWith;

    console.log(
      [
        String(count).padStart(6),
        `$${costWithout.toFixed(2)}`.padStart(12),
        `$${costWith.toFixed(2)}`.padStart(12),
        `$${costSaved.toFixed(2)}`.padStart(12),
      ].join(" | ")
    );
  }
}

runBenchmark();
