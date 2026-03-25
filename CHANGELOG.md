# Changelog

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
