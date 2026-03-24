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

## Full stack: GitHub, Jira, filesystem, Slack

A heavier setup for teams that use multiple services. This is where ToolStream's token savings become most dramatic. Without ToolStream, 4 servers with 30+ tools each sends 120+ tool schemas every turn.

Prerequisites:

```bash
export GITHUB_TOKEN="your-github-token"
export JIRA_TOKEN="your-jira-api-token"
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

  - id: "jira"
    name: "Jira"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-jira"]
    auth:
      type: "bearer"
      token_env: "JIRA_TOKEN"

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
- `confidence_threshold` is raised slightly to 0.35 because there are more tools competing. This keeps the signal-to-noise ratio clean.
- `context_window_turns` is raised to 4 because multi-server workflows often span more context.
- `top_k` stays at 5. With good routing, 5 tools per turn is enough for most tasks.

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
