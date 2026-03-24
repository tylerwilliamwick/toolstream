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
}

export interface RouteResult {
  candidates: ScoredTool[];
  belowThreshold: boolean;
}

export interface ScoredTool {
  tool: ToolRecord;
  score: number;
  source: "semantic" | "meta_tool" | "startup";
}

export interface ServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  auth: AuthConfig;
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
  };
  storage: {
    provider: "sqlite" | "pgvector";
    sqlitePath?: string;
  };
  servers: ServerConfig[];
}

export interface ServerRecord {
  id: string;
  displayName: string;
  transportType: string;
  lastSyncedAt: number | null;
  toolCount: number;
}
