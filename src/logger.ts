// src/logger.ts - Zero-dependency JSON logger (never writes to stdout)

import { appendFileSync, statSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

type LogLevel = "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

interface LogContext {
  sessionId?: string;
  serverId?: string;
  toolName?: string;
  [key: string]: unknown;
}

class Logger {
  private level: number = LEVELS.info;
  private filePath: string | null = null;
  private maxSizeBytes: number = 50 * 1024 * 1024; // 50MB

  configure(options: { level?: LogLevel; file?: string; maxSizeMb?: number }): void {
    if (options.level) this.level = LEVELS[options.level];
    if (options.file) {
      this.filePath = options.file.replace("~", process.env.HOME || "");
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    if (options.maxSizeMb) this.maxSizeBytes = options.maxSizeMb * 1024 * 1024;
  }

  error(message: string, context?: LogContext): void { this.log("error", message, context); }
  warn(message: string, context?: LogContext): void { this.log("warn", message, context); }
  info(message: string, context?: LogContext): void { this.log("info", message, context); }
  debug(message: string, context?: LogContext): void { this.log("debug", message, context); }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVELS[level] > this.level) return;

    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
    });

    // Write to file if configured
    if (this.filePath) {
      this.rotateIfNeeded();
      appendFileSync(this.filePath, entry + "\n");
    }

    // Always write to stderr (never stdout - that's MCP protocol)
    process.stderr.write(`[${level.toUpperCase()}] ${message}\n`);
  }

  private rotateIfNeeded(): void {
    if (!this.filePath) return;
    try {
      const stats = statSync(this.filePath);
      if (stats.size >= this.maxSizeBytes) {
        renameSync(this.filePath, `${this.filePath}.1`);
      }
    } catch {
      // File doesn't exist yet, no rotation needed
    }
  }
}

export const logger = new Logger();
