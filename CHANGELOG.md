# Changelog

## [3.0.0] - 2026-04-14

### Added
- **Strategy pattern (Phase C):** `RoutingStrategy` interface with `BaselineStrategy` and `NullStrategy` implementations; `StrategySelector` uses FNV-1a 32-bit hash bucketing by session ID for deterministic A/B assignment
- **Route tracing:** `TraceStore` writes one `RouteTrace` per routing call to SQLite (`route_traces` table) asynchronously via `setImmediate`; stores candidates, scores, boosts, and latency
- **Oracle implicit precision:** `Oracle.evalRolling7d(strategyId)` computes rolling 7-day precision@K from surfaced tool IDs vs. actual tool calls; exposed via `toolstream stats --oracle`
- **`toolstream explain <session-id>` CLI:** dumps route traces for a session from SQLite; shows strategy, query, surfaced tools, threshold status, and latency per turn
- **Cold-start fix:** session cold-start now embeds and surfaces popular tools without requiring a prior semantic query
- **Per-server timeout:** `servers[].timeout_ms` config field passes through to upstream MCP client
- **Rate limiting:** `Semaphore`-based concurrent tool call cap (`maxConcurrentToolCalls` config field, default 10)
- **Session timeout:** idle sessions are reaped after configurable inactivity window
- **P@5 benchmark:** `test/routing-quality.test.ts` with 50 curated query/tool pairs; gate raised to ≥0.80 Precision@5
- 6 new tests for Oracle, explain CLI (227 total)

### Changed
- `SemanticRouter` delegates to `BaselineStrategy`; exposes `get baselineStrategy()` accessor
- `ProxyServer` wired with `StrategySelector` and `TraceStore`; `routeContext` emits a trace per call
- `start.ts` constructs `StrategySelector` and `TraceStore`, wires into `ProxyServer`, runs prune interval
- `stats` command accepts `--oracle` flag and `injectedDb` option for testability

## [2.0.0] - 2026-03-24

### Added
- **Usage Analytics (7a):** Tool call tracking with co-occurrence analysis, 30-day retention, `toolstream stats` CLI command
- **Popularity Pre-loading (7b):** Sessions start with top-N historically popular tools pre-surfaced
- **Session-Level Multi-Turn Routing (7c):** Conversation topic tracking biases routing toward the dominant server
- **Configurable Top-K Profiles (7d):** Per-server `routing.top_k` override in YAML config
- **OpenAI Embedding Support (7e):** `embedding.provider: "openai"` with automatic fallback to local ONNX
- Synthetic benchmark script (`npm run benchmark`)
- Before/after SVG comparison images in README
- Enhanced issue templates with structured fields and template chooser
- CI link check via lychee (internal markdown links)
- Schema V3 migration (tool_call_events, tool_cooccurrence tables)
- Provider-switch detection at startup (clears and re-embeds on model change)
- Dimension guard in vector search (prevents cross-provider comparison errors)
- 38 new tests (159 total across 22 test files)

### Changed
- `SemanticRouter.route()` accepts optional `sessionContext` parameter for topic bias
- `SessionManager` constructor accepts optional `analyticsStore` and `registry` for pre-loading
- `EmbeddingEngine` supports dynamic vector dimensions (384 local, 1536 OpenAI)
- `ToolRegistry.topKByVector()` skips dimension-mismatched vectors

## [1.0.1] - 2026-03-24

### Added
- Atlassian (Jira + Confluence) integration via `mcp-atlassian` with `env_passthrough` for credentials
- Documentation for `env_passthrough` pattern in README, examples, and setup guide

### Changed
- Updated "Full stack" config example to use `mcp-atlassian` (replaces old `@modelcontextprotocol/server-jira`)
- README flowchart now includes Atlassian server
- Token savings table updated with real-world Atlassian numbers (72 tools, 96% reduction)

## [1.0.0] - 2026-03-24

### Added
- Core MCP proxy with semantic tool routing
- 3 meta-tools: discover_servers, discover_tools, execute_tool
- Local embedding engine (all-MiniLM-L6-v2, ONNX)
- SQLite storage with migration support (Schema V2)
- Interactive CLI: init, add-server, health, doctor, start
- Web dashboard on localhost:4242 (--ui flag)
- Auto-reconnection with exponential backoff (1s to 30s, max 10 attempts)
- Health check ping loop (60s interval, 10s timeout)
- Custom JSON logger (zero dependencies, file + stderr output)
- Telegram notifications via Bot API (per-event throttle)
- LaunchAgent for macOS process supervision
- 119 tests across 15 test files
- Comprehensive documentation (10+ pages)
