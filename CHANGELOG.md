# Changelog

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
