#!/usr/bin/env node
// src/index.ts - ToolStream CLI entry point

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./config-loader.js";
import { ToolStreamDatabase } from "./database.js";
import { EmbeddingEngine } from "./embedding-engine.js";
import { ToolRegistry } from "./tool-registry.js";
import { SemanticRouter } from "./semantic-router.js";
import { SessionManager } from "./session-manager.js";
import { UpstreamManager } from "./upstream-manager.js";
import { DependencyResolver } from "./dependency-resolver.js";
import { ProxyServer } from "./proxy-server.js";

async function main(): Promise<void> {
  const configPath = resolve(
    process.argv[2] || "toolstream.config.yaml"
  );

  if (!existsSync(configPath)) {
    console.error(`[ToolStream] Config file not found: ${configPath}`);
    console.error(
      "Usage: toolstream [config-path]  (default: toolstream.config.yaml)"
    );
    process.exit(1);
  }

  console.error(`[ToolStream] Loading config from ${configPath}`);
  const config = loadConfig(configPath);

  // Initialize database
  const dbPath = resolve(config.storage.sqlitePath || "./toolstream.db");
  console.error(`[ToolStream] Opening database at ${dbPath}`);
  const db = new ToolStreamDatabase(dbPath);

  // Initialize embedding engine
  console.error("[ToolStream] Initializing embedding engine...");
  const embedEngine = new EmbeddingEngine(config.embedding.provider);
  await embedEngine.initialize();
  console.error("[ToolStream] Embedding engine ready");

  // Initialize components
  const registry = new ToolRegistry(db, embedEngine, config.embedding.model);
  await registry.loadIndex();

  const router = new SemanticRouter(embedEngine, registry, config.routing);
  const sessionManager = new SessionManager(db);
  sessionManager.startCleanup();

  const upstreamManager = new UpstreamManager(registry);
  const dependencyResolver = new DependencyResolver();

  // Connect to upstream servers
  console.error(
    `[ToolStream] Connecting to ${config.servers.length} upstream servers...`
  );
  await upstreamManager.connectAll(config.servers);

  // Register tools for dependency resolution
  for (const server of config.servers) {
    const tools = registry.getAllActiveTools().filter(
      (t) => t.serverId === server.id
    );
    if (tools.length > 0) {
      dependencyResolver.registerTools(server.id, tools);
    }
  }

  const status = upstreamManager.getServerStatus();
  const healthy = status.filter((s) => s.healthy).length;
  console.error(
    `[ToolStream] ${healthy}/${status.length} servers connected, ${registry.indexSize} tools indexed`
  );

  // Start proxy server
  const proxy = new ProxyServer(
    config,
    sessionManager,
    router,
    registry,
    upstreamManager,
    dependencyResolver
  );

  // Graceful shutdown
  const shutdown = async () => {
    console.error("\n[ToolStream] Shutting down...");
    await proxy.stop();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await proxy.start();
}

main().catch((err) => {
  console.error("[ToolStream] Fatal error:", err);
  process.exit(1);
});
