# ToolStream

A standalone MCP proxy that makes tool loading intelligent. Sessions start with zero tool schemas. As the conversation progresses, ToolStream predicts which tools are relevant using semantic embeddings and surfaces only those tools to the LLM.

**Result:** 90%+ reduction in tool-related token consumption with no loss of capability.

## How It Works

1. LLM client connects to ToolStream as a single MCP server
2. ToolStream returns 3 meta-tools: `discover_servers`, `discover_tools`, `execute_tool`
3. As conversation context arrives, semantic routing surfaces relevant tools automatically
4. The LLM can always fall back to `discover_tools` for explicit search

## Quick Start

```bash
# Install
npm install

# Configure upstream servers
cp toolstream.config.yaml my-config.yaml
# Edit my-config.yaml with your MCP servers

# Build
npm run build

# Run
node dist/index.js my-config.yaml
```

## Configuration

ToolStream uses a YAML config file. See `toolstream.config.yaml` for the full template.

```yaml
toolstream:
  transport:
    stdio: true
  embedding:
    provider: "local"          # local ONNX inference, no API calls
    model: "all-MiniLM-L6-v2"
  routing:
    top_k: 5                   # tools surfaced per turn
    confidence_threshold: 0.3  # minimum similarity score
    context_window_turns: 3    # turns of context for routing
  storage:
    provider: "sqlite"
    sqlite_path: "./toolstream.db"

servers:
  - id: "filesystem"
    name: "Filesystem Server"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    auth:
      type: "none"

  - id: "github"
    name: "GitHub MCP Server"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
    auth:
      type: "bearer"
      token_env: "GITHUB_TOKEN"
```

## Claude Code Integration

Add ToolStream as an MCP server in your Claude Code settings:

```json
{
  "mcpServers": {
    "toolstream": {
      "command": "node",
      "args": ["/path/to/toolstream/dist/index.js", "/path/to/toolstream.config.yaml"]
    }
  }
}
```

Then remove the individual MCP server entries that ToolStream proxies. ToolStream handles all of them through a single connection.

## Meta-Tools

These 3 tools are always visible to the LLM:

| Tool | Purpose |
|------|---------|
| `discover_servers` | List all upstream MCP servers with IDs and tool counts |
| `discover_tools` | Search for tools by natural language query |
| `execute_tool` | Call any tool on any server directly by name |

## Architecture

- **Runtime**: Node.js 20+ with TypeScript
- **Embeddings**: `all-MiniLM-L6-v2` via `@xenova/transformers` (local, no API cost)
- **Storage**: SQLite with WAL mode via `better-sqlite3`
- **Protocol**: MCP 2025-06-18 spec compliant via `@modelcontextprotocol/sdk`

## Development

```bash
# Run tests
npm test

# Type check
npx tsc --noEmit

# Build
npm run build
```

## Token Savings

| Scenario | Before | After | Savings |
|----------|--------|-------|---------|
| 107 tools | ~32K tokens/turn | ~2.8K tokens/turn | 91% |
| 200 tools | ~100K tokens/turn | ~2.8K tokens/turn | 97% |

## License

MIT
