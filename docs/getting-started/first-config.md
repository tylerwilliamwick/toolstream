# First Config

ToolStream uses a single YAML file for all configuration. MCP (Model Context Protocol) is the standard that lets AI assistants connect to external services; each service you connect is called an "MCP server." This guide walks through each section of the config file and explains what each field does.

---

## The full template

```yaml
toolstream:
  transport:
    stdio: true
    http:
      enabled: false
      port: 3000
      host: "127.0.0.1"

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
    name: "Filesystem Server"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    auth:
      type: "none"
```

---

## `toolstream.transport`

Controls how ToolStream listens for connections from your LLM client.

**`stdio: true`**
Use stdio transport. This is the right choice for Claude Code and most local setups. Keep this `true`.

**`http.enabled: false`**
ToolStream can also listen on HTTP for programmatic access. Leave this `false` unless you're building a custom integration that needs HTTP.

**`http.port`** and **`http.host`**
Only relevant when `http.enabled` is `true`. Default port is 3000, default host is localhost.

---

## `toolstream.embedding`

Controls how ToolStream converts text into semantic vectors for routing.

**`provider: "local"`**
Runs inference locally using ONNX. No external API calls, no API key required, no cost per embedding. This is the default and recommended setting.

The alternative is `"openai"`, which uses OpenAI's embedding API. You'd need to add `openai_api_key` and change `model` to an OpenAI embedding model name. Only useful if local inference is too slow on your hardware.

**`model: "all-MiniLM-L6-v2"`**
The embedding model to use. This model is small (22MB), fast, and performs well for tool routing. Don't change this unless you have a specific reason.

---

## `toolstream.routing`

Controls how ToolStream decides which tools to surface each turn.

**`top_k: 5`**
The maximum number of tools surfaced automatically per conversation turn. A value of 5 means Claude sees at most 5 tool schemas beyond the 4 meta-tools. Raise this if Claude frequently says it can't find the right tool. Lower it to save more tokens.

**`confidence_threshold: 0.3`**
The minimum similarity score (0 to 1) a tool must reach to be surfaced. Tools below this score are skipped. Raise this to be more selective. Lower it if ToolStream is missing tools that should be surfaced.

**`context_window_turns: 3`**
How many recent conversation turns ToolStream uses when computing semantic similarity. A value of 3 means it considers the last 3 turns of conversation. Raise this for longer-context routing. Lowering it makes routing respond more to recent messages.

---

## `toolstream.storage`

Controls where ToolStream stores tool records and embeddings.

**`provider: "sqlite"`**
Use SQLite for local storage. This is the default. SQLite creates a single file on disk; no database server needed.

**`sqlite_path: "./toolstream.db"`**
Path to the SQLite database file. Relative paths are relative to where you run ToolStream from. Change this if you want the file in a specific location.

The alternative provider is `"pgvector"`, which uses a PostgreSQL database with the pgvector extension. This is for production deployments where you want persistent storage across restarts and support for multiple concurrent sessions.

---

## `servers`

A list of MCP servers that ToolStream will connect to and proxy. Each entry describes one server.

**`id`**
A short identifier for this server. Used internally and shown in `discover_servers` output. Must be unique across all servers in your config. Use lowercase with underscores or hyphens.

**`name`**
A human-readable display name. Shown in `discover_servers` output. Can include spaces.

**`transport`**
How ToolStream talks to this server. `"stdio"` means it launches the server as a subprocess. `"http"` means it connects to a running HTTP server.

**`command`** and **`args`**
For stdio transport only. `command` is the executable to run, `args` is the list of arguments. Most MCP servers can be launched with `npx`.

**`url`**
For http transport only. The base URL of the running server.

**`auth`**
Authentication for this server. See [Auth Guide](../configuration/auth-guide.md) for full details. Common options:
- `type: "none"` for servers that don't require auth
- `type: "bearer"` with `token_env` set to an environment variable name for token-based auth
- `type: "env"` for servers that read credentials from environment variables directly

---

## Usage analytics

ToolStream tracks which tools you call automatically. No configuration is required to turn it on; it's active by default.

To see a summary of your tool usage, run:

```bash
toolstream stats
```

This shows call counts by server and tool, giving you a sense of which tools are actually doing work in your conversations. See [Concepts: Usage Analytics](../concepts/analytics.md) for more on what's tracked and how to interpret the output.

---

## Adding your first real server

Replace the example filesystem entry with a path you actually want to give Claude access to:

```yaml
servers:
  - id: "filesystem"
    name: "Filesystem Server"
    transport: "stdio"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/yourname/Documents"]
    auth:
      type: "none"
```

Then restart ToolStream. See [Configuration Examples](../configuration/examples.md) for common multi-server setups.
