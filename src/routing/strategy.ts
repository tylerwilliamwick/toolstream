// src/routing/strategy.ts - Strategy pattern for semantic routing

import type { ScoredTool, SessionTopicContext } from "../types.js";

export interface TraceCandidate {
  toolId: string;
  baseScore: number;
  boosts: Record<string, number>;
  finalScore: number;
}

export interface RouteTrace {
  sessionId: string;
  ts: number;
  queryText: string;
  contextWindow: string;
  strategyId: string;
  candidates: TraceCandidate[];
  surfacedToolIds: string[];
  belowThreshold: boolean;
  latencyMs: number;
}

export interface RouteStrategyResult {
  candidates: ScoredTool[];
  belowThreshold: boolean;
  trace: RouteTrace;
}

export interface RouteStrategyInput {
  sessionId: string;
  contextBuffer: string[];
  sessionContext?: SessionTopicContext | null;
}

export interface RoutingStrategy {
  readonly id: string;
  route(input: RouteStrategyInput): Promise<RouteStrategyResult>;
}
