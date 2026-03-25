# ToolStream Roadmap

ToolStream is an open-source MCP proxy that cuts tool token usage by 90% or more. Every LLM session starts with just 4 small tools instead of hundreds of schemas. As the conversation progresses, ToolStream brings the right tools into context using semantic search. Nothing is hidden, nothing is lost.

v1.0 is shipped and running. Here's what's built, what's next, and how to help.

## Status

| Symbol | Meaning |
|--------|---------|
| Done | Shipped in the current release |
| In Progress | Actively being built |
| Planned | Scoped and designed, not yet started |

## v1.0: Core Proxy (Done)

Everything you need to run ToolStream in production with Claude Code or any MCP client.

| Feature | Description |
|---------|-------------|
| MCP proxy with stdio transport | Sits between your LLM client and all upstream MCP servers transparently |
| 4 meta-tools | `discover_servers`, `discover_tools`, `execute_tool`, `reconnect_server` are always visible |
| Semantic routing engine | Local ONNX inference with all-MiniLM-L6-v2 (384-dim vectors, <50ms per query) |
| Tool dependency resolution | When a tool is surfaced, related tools on the same server are auto-surfaced too |
| SQLite storage | Persistent tool registry with schema migrations, WAL mode |
| Auth passthrough | Supports none, env, bearer, header auth types plus env_passthrough for credential forwarding |
| Streaming proxy | Forwards tool responses chunk by chunk without buffering |
| Read-only web dashboard | Live server health, tool catalog, and routing config at localhost:4242 |
| Self-healing reconnection | Exponential backoff (1s to 30s), max 10 attempts, manual reconnect via meta-tool |
| Interactive CLI | `toolstream init`, `add-server`, `health`, `doctor`, `start` |
| Telegram notifications | Configurable alerts via Bot API with per-event throttling |

## Phase 2: Conversation Intelligence (Planned)

Making routing smarter by learning from conversation patterns.

| Feature | Description |
|---------|-------------|
| Multi-turn routing | Analyze the last N turns for context instead of just the latest message |
| Tool usage analytics | Track which tools are called, how often, and in what sequences |
| Popularity pre-loading | Surface frequently used tools at session start before any message |
| Configurable top-K profiles | Different K values per server or tool category |
| OpenAI embedding support | Optional API-backed embeddings for higher accuracy |

**Depends on:** v1.0 complete (done), usage data collected for 2+ weeks.

## Phase 3: Scale and Management (Planned)

Running ToolStream at scale with better tooling for operators.

| Feature | Description |
|---------|-------------|
| pgvector support | PostgreSQL-backed vector store for deployments with 10,000+ tools |
| Multi-user session isolation | Separate routing contexts per user or client connection |
| Index persistence | Cache embeddings to disk for sub-2-second startup without re-embedding |
| Token refresh callbacks | Configurable handler for expired credentials with automatic retry |
| Full dashboard | Analytics panels, tool catalog browser, and routing config editor |

**Depends on:** Phase 2 analytics data, production deployment experience.

## Full Vision (Planned)

The long-term direction for ToolStream.

| Feature | Description |
|---------|-------------|
| Cross-session learning | Remember tool preferences across sessions for returning users |
| Team-shared tool profiles | Shared routing configurations so teams get consistent tool surfaces |
| A/B testing for routing | Compare routing strategies with controlled experiments |
| MCP spec evolution | Adopt hierarchical tool management if the MCP specification adds it |
| Plugin architecture | Third-party routing strategy plugins |

## Contributing

We welcome contributions at any level. Check [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines. If you want to pick up a planned feature, open an issue first so we can coordinate.

Good places to start:
- Look at `test/planned-features.test.ts` for `it.todo()` stubs that describe expected behavior for unbuilt features
- Browse open issues tagged `good-first-issue`
- Improve test coverage for existing features
