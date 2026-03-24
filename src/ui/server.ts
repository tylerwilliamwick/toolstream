// src/ui/server.ts - Read-only web dashboard for ToolStream

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolRegistry } from "../tool-registry.js";
import type { UpstreamManager } from "../upstream-manager.js";
import type { ToolStreamConfig } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface UIServerOptions {
  port: number;
  host: string;
  registry: ToolRegistry;
  upstreamManager: UpstreamManager;
  config: ToolStreamConfig;
}

const startTime = Date.now();

export async function startUIServer(
  options: UIServerOptions
): Promise<void> {
  const { port, host, registry, upstreamManager, config } = options;

  const publicDir = join(__dirname, "..", "..", "src", "ui", "public");
  // Fallback to dist-relative path
  const distPublicDir = join(__dirname, "public");

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    const path = url.pathname;

    // CORS headers for local development
    res.setHeader("Access-Control-Allow-Origin", "*");

    // API routes
    if (path === "/api/health") {
      const status = upstreamManager.getServerStatus();
      const uptime = Math.round((Date.now() - startTime) / 1000);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          uptime_seconds: uptime,
          servers: status.length,
          servers_healthy: status.filter((s) => s.healthy).length,
          tools_indexed: registry.indexSize,
        })
      );
      return;
    }

    if (path === "/api/servers") {
      const servers = registry.getAllServers();
      const status = upstreamManager.getServerStatus();
      const merged = servers.map((s) => {
        const health = status.find((st) => st.id === s.id);
        return {
          id: s.id,
          name: s.displayName,
          transport: s.transportType,
          tool_count: s.toolCount,
          healthy: health?.healthy ?? false,
          last_synced: s.lastSyncedAt,
        };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(merged));
      return;
    }

    if (path === "/api/tools") {
      const search = url.searchParams.get("q") || "";
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const limit = Math.min(
        parseInt(url.searchParams.get("limit") || "50", 10),
        200
      );

      let tools = registry.getAllActiveTools();

      if (search) {
        const q = search.toLowerCase();
        tools = tools.filter(
          (t) =>
            t.toolName.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.serverId.toLowerCase().includes(q)
        );
      }

      const total = tools.length;
      const offset = (page - 1) * limit;
      const paginated = tools.slice(offset, offset + limit);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          tools: paginated.map((t) => ({
            id: t.id,
            server: t.serverId,
            name: t.toolName,
            description: t.description,
          })),
          total,
          page,
          pages: Math.ceil(total / limit),
        })
      );
      return;
    }

    if (path === "/api/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          routing: {
            top_k: config.routing.topK,
            confidence_threshold: config.routing.confidenceThreshold,
            context_window_turns: config.routing.contextWindowTurns,
          },
          embedding: {
            provider: config.embedding.provider,
            model: config.embedding.model,
          },
          transport: {
            stdio: config.transport.stdio,
            http: config.transport.http?.enabled ?? false,
          },
        })
      );
      return;
    }

    if (path === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const interval = setInterval(() => {
        const status = upstreamManager.getServerStatus();
        res.write(
          `data: ${JSON.stringify({
            type: "health",
            servers: status,
            timestamp: Date.now(),
          })}\n\n`
        );
      }, 3000);

      req.on("close", () => {
        clearInterval(interval);
      });
      return;
    }

    // Static files
    let filePath: string;
    if (path === "/" || path === "/index.html") {
      filePath = "index.html";
    } else if (path === "/styles.css") {
      filePath = "styles.css";
    } else {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Try source dir first, then dist dir
    let fullPath = join(publicDir, filePath);
    if (!existsSync(fullPath)) {
      fullPath = join(distPublicDir, filePath);
    }

    if (!existsSync(fullPath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const contentType = filePath.endsWith(".css")
      ? "text/css"
      : "text/html";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(readFileSync(fullPath));
  });

  return new Promise((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `[ToolStream UI] Port ${port} is in use. Set a different port in config or use --ui-port.`
        );
        reject(err);
      } else {
        reject(err);
      }
    });

    server.listen(port, host, () => {
      resolve();
    });
  });
}
