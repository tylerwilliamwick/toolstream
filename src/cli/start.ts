// src/cli/start.ts - Start the ToolStream proxy

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../config-loader.js";
import { ToolStreamDatabase } from "../database.js";
import { EmbeddingEngine } from "../embedding-engine.js";
import { ToolRegistry } from "../tool-registry.js";
import { SemanticRouter } from "../semantic-router.js";
import { SessionManager } from "../session-manager.js";
import { UpstreamManager } from "../upstream-manager.js";
import { DependencyResolver } from "../dependency-resolver.js";
import { ProxyServer } from "../proxy-server.js";
import { logger } from "../logger.js";
import { HealthMonitor } from "../health-monitor.js";
import { TelegramNotifier, formatServerDown, formatServerRecovered } from "../notifications/telegram.js";

export async function startCommand(
  configPath: string,
  options: { ui?: boolean }
): Promise<void> {
  const resolvedPath = resolve(configPath);

  if (!existsSync(resolvedPath)) {
    logger.error(`[ToolStream] Config file not found: ${resolvedPath}`);
    logger.error(
      "Run 'toolstream init' to create a config file, or specify a path."
    );
    process.exit(1);
  }

  logger.error(`[ToolStream] Loading config from ${resolvedPath}`);
  const config = loadConfig(resolvedPath);

  // Configure logger from config
  if (config.logging) {
    logger.configure(config.logging);
  }

  // Initialize database
  const dbPath = resolve(config.storage.sqlitePath || "./toolstream.db");
  logger.error(`[ToolStream] Opening database at ${dbPath}`);
  const db = new ToolStreamDatabase(dbPath);

  // Initialize embedding engine
  logger.error("[ToolStream] Initializing embedding engine...");
  const embedEngine = new EmbeddingEngine(
    config.embedding.provider,
    config.embedding.openaiApiKey,
    config.embedding.model
  );
  await embedEngine.initialize();
  logger.error(`[ToolStream] Embedding engine ready (${embedEngine.activeProvider})`);

  // Initialize components
  const registry = new ToolRegistry(db, embedEngine, config.embedding.model);

  // Check for provider switch: if stored embeddings use a different model, clear and re-embed
  const existingEmbeddings = db.getAllEmbeddings();
  if (existingEmbeddings.length > 0) {
    const storedModelId = existingEmbeddings[0].model_id;
    const currentModelId = embedEngine.modelId;
    if (!storedModelId.startsWith(currentModelId.split(":")[0])) {
      logger.error(`[ToolStream] Provider switch detected (${storedModelId} -> ${currentModelId}), re-embedding all tools...`);
      db.clearEmbeddings();
      registry.clearVectorIndex();
    }
  }

  await registry.loadIndex();

  const router = new SemanticRouter(embedEngine, registry, config.routing, config.servers);
  const sessionManager = new SessionManager(
    db,
    config.sessionTimeoutMs,
    undefined,
    db,
    registry,
    config.routing.popularityPreloadCount ?? 3
  );
  sessionManager.startCleanup();

  const upstreamManager = new UpstreamManager(registry);
  upstreamManager.on('tools_resynced', (serverId) => {
    sessionManager.invalidateServerTools(serverId);
  });
  const dependencyResolver = new DependencyResolver();

  // Connect to upstream servers
  logger.error(
    `[ToolStream] Connecting to ${config.servers.length} upstream servers...`
  );
  await upstreamManager.connectAll(config.servers);

  // Register tools for dependency resolution
  for (const server of config.servers) {
    const tools = registry
      .getAllActiveTools()
      .filter((t) => t.serverId === server.id);
    if (tools.length > 0) {
      dependencyResolver.registerTools(server.id, tools);
    }
  }

  const status = upstreamManager.getServerStatus();
  const healthy = status.filter((s) => s.healthy).length;
  logger.error(
    `[ToolStream] ${healthy}/${status.length} servers connected, ${registry.indexSize} tools indexed`
  );

  // Prune old analytics events (30-day TTL)
  const pruned = db.pruneOldEvents(30);
  if (pruned > 0) {
    logger.error(`[ToolStream] Pruned ${pruned} analytics events older than 30 days`);
  }

  // Wire HealthMonitor
  const healthMonitor = new HealthMonitor(upstreamManager, db);
  healthMonitor.start();

  // Wire TelegramNotifier
  let telegram: TelegramNotifier | undefined;
  if (config.notifications?.telegram) {
    telegram = new TelegramNotifier(config.notifications.telegram);
    await telegram.initialize();

    upstreamManager.on('server_permanently_failed', (serverId) => {
      telegram!.notify('server_down', formatServerDown(serverId, 'Permanently failed after max reconnect attempts', 0, 0));
    });

    healthMonitor.on('server_down', (serverId: string, message: string) => {
      telegram!.notify('server_down', formatServerDown(serverId, message, 1, 1));
    });

    healthMonitor.on('server_recovered', (serverId: string, pingMs: number) => {
      telegram!.notify('server_recovered', formatServerRecovered(serverId, pingMs));
    });
  }

  // Start proxy server
  const proxy = new ProxyServer(
    config,
    sessionManager,
    router,
    registry,
    upstreamManager,
    dependencyResolver,
    db
  );

  // Start UI server if requested
  if (options.ui) {
    const { startUIServer } = await import("../ui/server.js");
    const uiPort =
      (config as any).ui?.port || 4242;
    const uiHost =
      (config as any).ui?.host || "127.0.0.1";
    await startUIServer({
      port: uiPort,
      host: uiHost,
      registry,
      upstreamManager,
      config,
    });
    logger.error(`[ToolStream] Dashboard: http://${uiHost}:${uiPort}`);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.error("\n[ToolStream] Shutting down...");
    healthMonitor.stop();
    sessionManager.stopCleanup();
    await proxy.stop();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Crash handlers
  process.on("unhandledRejection", async (reason) => {
    logger.error(`[ToolStream] Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
    await proxy.stop();
    sessionManager.stopCleanup();
    process.exit(1);
  });

  process.on("uncaughtException", async (err) => {
    logger.error(`[ToolStream] Uncaught exception: ${err.message}`);
    await proxy.stop();
    sessionManager.stopCleanup();
    process.exit(1);
  });

  await proxy.start();
}
