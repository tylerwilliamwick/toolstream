// src/types.ts - Core type definitions for ToolStream

export interface ToolRecord {
  id: string; // "{server_id}:{tool_name}"
  serverId: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isActive: boolean;
}

export interface SessionState {
  id: string;
  activeSurface: Map<string, ToolRecord>;
  contextBuffer: string[];
  createdAt: number;
  lastActiveAt: number;
  serverCallCounts: Map<string, number>;
  consecutiveNonDominantCalls: number;
}

export interface RouteResult {
  candidates: ScoredTool[];
  belowThreshold: boolean;
}

export interface ScoredTool {
  tool: ToolRecord;
  score: number;
  source: "semantic" | "meta_tool" | "startup" | "passthrough";
}

export interface ServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  auth: AuthConfig;
  envPassthrough?: string[]; // Env var names to pass to child process (security: allowlist)
  timeout_ms?: number; // Per-server tool call timeout in ms (default: 30000)
  routing?: {
    topK?: number; // Per-server override of global top_k (1-20)
  };
}

export interface AuthConfig {
  type: "none" | "env" | "bearer" | "header";
  tokenEnv?: string;
  headerName?: string;
}

export interface ToolStreamConfig {
  transport: {
    stdio: boolean;
    http?: { enabled: boolean; port: number; host: string };
  };
  embedding: {
    provider: "local" | "openai";
    model: string;
    openaiApiKey?: string;
  };
  routing: {
    topK: number;
    confidenceThreshold: number;
    contextWindowTurns: number;
    popularityPreloadCount?: number;
  };
  storage: {
    provider: "sqlite" | "pgvector";
    sqlitePath?: string;
  };
  servers: ServerConfig[];
  logging?: {
    level: "error" | "warn" | "info" | "debug";
    file: string;
    maxSizeMb: number;
  };
  notifications?: {
    telegram?: {
      botToken: string;
      chatId: string;
      events: string[];
      throttleSeconds: number;
    };
  };
  sessionTimeoutMs?: number;
}

export interface SessionTopicContext {
  dominantServerId: string;
  confidence: number;
}

export interface ServerRecord {
  id: string;
  displayName: string;
  transportType: string;
  lastSyncedAt: number | null;
  toolCount: number;
}
