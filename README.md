# ToolStream

A standalone MCP proxy that makes tool loading intelligent. Sessions start with zero tool schemas. As the conversation progresses, ToolStream predicts which tools are relevant using semantic embeddings and surfaces only those tools to the LLM.

**Result:** 90%+ reduction in tool-related token consumption with no loss of capability.

## How It Works

1. LLM client connects to ToolStream as a single MCP server
2. ToolStream returns 3 meta-tools: `discover_servers`, `discover_tools`, `execute_tool`
3. As conversation context arrives, semantic routing surfaces relevant tools automatically
4. The LLM can always fall back to `discover_tools` for explicit search

```mermaid
flowchart TD
    Client["Claude Code\n(LLM client)"]
    TS["Toolstream Proxy\n─────────────────\nSemantic Router\nSession Manager\nTool Registry\nHealth Monitor"]
    GH["GitHub MCP Server\n(26 tools)"]
    AT["Atlassian MCP Server\n(Jira + Confluence, 72 tools)"]
    OB["Obsidian MCP Server\n(14 tools)"]
    OT["Other MCP Servers..."]
    TG["Telegram Bot API"]

    Client -- "stdio (3 meta-tools)" --> TS
    TS -- "stdio" --> GH
    TS -- "stdio + env_passthrough" --> AT
    TS -- "stdio" --> OB
    TS -- "stdio" --> OT
    TS -- "HTTPS (alerts)" --> TG
```

## Quick Start

```bash
git clone https://github.com/tylerwilliamwick/toolstream.git
cd toolstream
npm install
npm run build
cp toolstream.config.yaml my-config.yaml
# Edit my-config.yaml with your MCP servers
node dist/index.js start my-config.yaml
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

  - id: "mcp-atlassian"
    name: "Atlassian (Jira + Confluence)"
    transport: "stdio"
    command: "uvx"
    args: ["mcp-atlassian"]
    auth:
      type: "none"
    env_passthrough:             # credentials from parent process env
      - "JIRA_URL"
      - "JIRA_USERNAME"
      - "JIRA_API_TOKEN"
      - "CONFLUENCE_URL"
      - "CONFLUENCE_USERNAME"
      - "CONFLUENCE_API_TOKEN"
```

## Claude Code Integration

Add ToolStream as an MCP server in your Claude Code settings:

```json
{
  "mcpServers": {
    "toolstream": {
      "command": "node",
      "args": ["/path/to/toolstream/dist/index.js", "/path/to/toolstream.config.yaml"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-github-token",
        "JIRA_URL": "https://yourorg.atlassian.net",
        "JIRA_USERNAME": "you@example.com",
        "JIRA_API_TOKEN": "your-jira-api-token",
        "CONFLUENCE_URL": "https://yourorg.atlassian.net/wiki",
        "CONFLUENCE_USERNAME": "you@example.com",
        "CONFLUENCE_API_TOKEN": "your-confluence-api-token"
      }
    }
  }
}
```

Credentials go in the `env` block of the toolstream server entry. ToolStream forwards them to upstream servers via `env_passthrough` in the YAML config. Then remove the individual MCP server entries that ToolStream proxies. ToolStream handles all of them through a single connection.

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
| 112 tools (GitHub + Obsidian + Atlassian) | ~35K tokens/session start | ~1.5K tokens/session start | 96% |
| 200 tools | ~100K tokens/turn | ~2.8K tokens/turn | 97% |

Real-world example: Atlassian alone has 72 tools. Without ToolStream, all 72 tool schemas load on every session start. With ToolStream, they only load when you first call a Jira or Confluence tool.

## Known Limitations

- **Single client per instance**: Toolstream uses a single session ID for stdio transport, designed for one-to-one client connections (e.g., one Claude Code instance). Running multiple clients against the same Toolstream instance will share session state.

## License

MIT
