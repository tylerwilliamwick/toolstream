import { describe, it } from "vitest";

describe("Phase 2: Conversation Intelligence (planned)", () => {
  describe("Multi-turn routing", () => {
    it.todo("routes based on last N turns, not just the latest message");
    it.todo(
      "configurable context_window_turns per session overrides global setting"
    );
    it.todo("context window sliding removes oldest turns at cap");
  });

  describe("Tool usage analytics", () => {
    it.todo("records tool call events to the analytics store");
    it.todo("getToolCallFrequency returns sorted list by call count");
    it.todo("analytics persist across proxy restarts");
  });

  describe("Popularity pre-loading", () => {
    it.todo(
      "surfaces top-3 most-called tools at session start before any message"
    );
    it.todo(
      "popularity list updates after each session without full rebuild"
    );
  });

  describe("Configurable top-K profiles", () => {
    it.todo("server-level top_k overrides global top_k");
    it.todo(
      "tool category profiles (e.g., file_ops: top_k=3) apply correctly"
    );
  });

  describe("OpenAI embedding support", () => {
    it.todo("EmbeddingEngine accepts provider: 'openai' in config");
    it.todo(
      "OpenAI provider calls the embeddings API with the correct model"
    );
    it.todo("falls back to local if OPENAI_API_KEY is not set");
  });
});

describe("Phase 3: Scale and Management (planned)", () => {
  describe("pgvector support", () => {
    it.todo("ToolRegistry accepts provider: 'pgvector' in storage config");
    it.todo(
      "cosine search against pgvector returns same top-K as SQLite for same index"
    );
  });

  describe("Index persistence", () => {
    it.todo("EmbeddingIndex saves to disk on shutdown");
    it.todo(
      "startup with persisted index skips re-embedding and completes in <2 seconds"
    );
  });

  describe("Multi-user session isolation", () => {
    it.todo(
      "two sessions with same tool catalog have independent active surfaces"
    );
    it.todo(
      "surfacing a tool in session A does not surface it in session B"
    );
  });

  describe("Token refresh callbacks", () => {
    it.todo(
      "upstream call with expired token invokes the configured refresh callback"
    );
    it.todo(
      "refreshed token is used for the retry without user intervention"
    );
  });

  describe("Full dashboard", () => {
    it.todo("analytics panel shows tool call frequency and trends");
    it.todo("routing config editor saves changes to config file");
  });
});
