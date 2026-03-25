# Configuration Examples

Common setups you can copy and adapt.

---

## Filesystem only

The simplest useful config. Gives Claude access to a local directory.

```yaml
toolstream:
  transport:
    stdio: true
  embedding:
    provider: "local"
    model: "all-MiniLM-L6-v2"
  routing:
    top_k: 5
    confidence_threshold: 0.3
    context_window_turns: 3
  storage:
    provider: "sqlite"
    sqlite_path: "./toolstream.db"

servers:
  - id: "filesystem"
    name: "Filesystem"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/yourname/Documents"]
    auth:
      type: "none"
```

Change `/Users/yourname/Documents` to the directory you want Claude to read and write.

---

## GitHub and filesystem

A common pairing for software projects. Gives Claude access to your files and your GitHub repos.

Prerequisite: set the `GITHUB_TOKEN` environment variable before starting ToolStream.

```bash
export GITHUB_TOKEN="your-token-here"
```

```yaml
toolstream:
  transport:
    stdio: true
  embedding:
    provider: "local"
    model: "all-MiniLM-L6-v2"
  routing:
    top_k: 8
    confidence_threshold: 0.3
    context_window_turns: 3
  storage:
    provider: "sqlite"
    sqlite_path: "./toolstream.db"

servers:
  - id: "filesystem"
    name: "Filesystem"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/yourname/projects"]
    auth:
      type: "none"

  - id: "github"
    name: "GitHub"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
    auth:
      type: "bearer"
      token_env: "GITHUB_TOKEN"
```

`top_k` is set to 8 here because the combined tool count is higher. Adjust based on how many tokens you want to spend per turn.

---

## Full stack: GitHub, Atlassian (Jira + Confluence), filesystem, Slack

A heavier setup for teams that use multiple services. This is where ToolStream's token savings become most dramatic. Without ToolStream, 4 servers with 30+ tools each sends 120+ tool schemas every turn. Atlassian alone contributes 72 tools.

Prerequisites: set environment variables before starting ToolStream, or pass them via `env` in your Claude Code config.

```bash
export GITHUB_TOKEN="your-github-token"
export JIRA_URL="https://yourorg.atlassian.net"
export JIRA_USERNAME="you@example.com"
export JIRA_API_TOKEN="your-jira-api-token"
export CONFLUENCE_URL="https://yourorg.atlassian.net/wiki"
export CONFLUENCE_USERNAME="you@example.com"
export CONFLUENCE_API_TOKEN="your-confluence-api-token"
export SLACK_TOKEN="your-slack-bot-token"
```

```yaml
toolstream:
  transport:
    stdio: true
  embedding:
    provider: "local"
    model: "all-MiniLM-L6-v2"
  routing:
    top_k: 5
    confidence_threshold: 0.35
    context_window_turns: 4
  storage:
    provider: "sqlite"
    sqlite_path: "./toolstream.db"

servers:
  - id: "filesystem"
    name: "Filesystem"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/yourname/projects"]
    auth:
      type: "none"

  - id: "github"
    name: "GitHub"
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
    env_passthrough:
      - "JIRA_URL"
      - "JIRA_USERNAME"
      - "JIRA_API_TOKEN"
      - "CONFLUENCE_URL"
      - "CONFLUENCE_USERNAME"
      - "CONFLUENCE_API_TOKEN"

  - id: "slack"
    name: "Slack"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-slack"]
    auth:
      type: "bearer"
      token_env: "SLACK_TOKEN"
```

Notes on this config:
- **Atlassian uses `env_passthrough`** instead of bearer auth. The `mcp-atlassian` server reads credentials from environment variables. List the variable names in `env_passthrough` so ToolStream forwards them from the parent process to the child.
- `confidence_threshold` is raised slightly to 0.35 because there are more tools competing. This keeps the signal-to-noise ratio clean.
- `context_window_turns` is raised to 4 because multi-server workflows often span more context.
- `top_k` stays at 5. With good routing, 5 tools per turn is enough for most tasks.

---

## OpenAI embeddings

Use OpenAI's embedding API instead of local inference. This trades API cost for faster startup and no local model download.

Prerequisite: set the `OPENAI_API_KEY` environment variable before starting ToolStream.

```bash
export OPENAI_API_KEY="your-openai-api-key"
```

```yaml
toolstream:
  transport:
    stdio: true
  embedding:
    provider: "openai"
    model: "text-embedding-3-small"
    openai_api_key: "${OPENAI_API_KEY}"
  routing:
    top_k: 5
    confidence_threshold: 0.3
    context_window_turns: 3
  storage:
    provider: "sqlite"
    sqlite_path: "./toolstream.db"

servers:
  - id: "filesystem"
    name: "Filesystem"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/yourname/Documents"]
    auth:
      type: "none"
```

Notes on this config:
- `text-embedding-3-small` is OpenAI's fastest and cheapest embedding model. It works well for tool routing.
- Embeddings are computed once at startup and cached in SQLite. You pay for embeddings when you first run or when tools change, not on every turn.
- If you switch from `"local"` to `"openai"` (or change models), delete `toolstream.db` and restart to rebuild the index with the new model.

---

## Per-server top_k override

When one server has many more tools than the others, you can give it a higher `top_k` so it doesn't get crowded out by the global limit. This is common with Atlassian, which exposes 72+ tools across Jira and Confluence.

```yaml
toolstream:
  transport:
    stdio: true
  embedding:
    provider: "local"
    model: "all-MiniLM-L6-v2"
  routing:
    top_k: 5
    confidence_threshold: 0.3
    context_window_turns: 3
  storage:
    provider: "sqlite"
    sqlite_path: "./toolstream.db"

servers:
  - id: "filesystem"
    name: "Filesystem"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/yourname/projects"]
    auth:
      type: "none"

  - id: "mcp-atlassian"
    name: "Atlassian (Jira + Confluence)"
    transport: "stdio"
    command: "uvx"
    args: ["mcp-atlassian"]
    auth:
      type: "none"
    env_passthrough:
      - "JIRA_URL"
      - "JIRA_USERNAME"
      - "JIRA_API_TOKEN"
      - "CONFLUENCE_URL"
      - "CONFLUENCE_USERNAME"
      - "CONFLUENCE_API_TOKEN"
    routing:
      top_k: 12
```

The global `top_k` is 5, but the Atlassian server can surface up to 12 tools per turn. The filesystem server still follows the global limit of 5. The total tools surfaced per turn across all servers is the sum of each server's effective `top_k`.

---

## Using an HTTP MCP server

If you're running an MCP server with its own HTTP endpoint instead of launching it as a subprocess:

```yaml
servers:
  - id: "my-api-server"
    name: "Custom API Server"
    transport: "http"
    url: "http://localhost:4000"
    auth:
      type: "bearer"
      token_env: "MY_API_TOKEN"
```

Make sure the server is running before you start ToolStream.
