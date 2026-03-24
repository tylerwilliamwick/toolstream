# Configuration Reference

Full reference for every field in `toolstream.config.yaml`.

---

## `toolstream.transport`

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `transport.stdio` | boolean | `true` | yes | Enable stdio transport. Required for Claude Code and most local use cases. |
| `transport.http.enabled` | boolean | `false` | no | Enable HTTP transport for programmatic or remote access. |
| `transport.http.port` | integer | `3000` | no | Port to listen on when HTTP is enabled. Must be an unused port between 1024 and 65535. |
| `transport.http.host` | string | `"127.0.0.1"` | no | Host to bind when HTTP is enabled. Use `"0.0.0.0"` to accept connections from other machines (not recommended for local setups). |

**What goes wrong if misconfigured:**
- Both `stdio` and `http` can be enabled simultaneously if you need both transports.
- Setting `http.host` to `"0.0.0.0"` without firewall rules exposes ToolStream to your local network.

---

## `toolstream.embedding`

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `embedding.provider` | `"local"` or `"openai"` | `"local"` | yes | Where to run embedding inference. `"local"` uses ONNX, no API cost. `"openai"` uses OpenAI's API. |
| `embedding.model` | string | `"all-MiniLM-L6-v2"` | yes | Model name. For `"local"`, this is the Hugging Face model ID. For `"openai"`, use an OpenAI embedding model name like `"text-embedding-3-small"`. |
| `embedding.openai_api_key` | string | none | only if `provider: "openai"` | Your OpenAI API key. Can also be set via the `OPENAI_API_KEY` environment variable. |

**What goes wrong if misconfigured:**
- Using `"openai"` without a valid API key causes ToolStream to fail at startup.
- Changing the `model` after you've already built an embedding index requires re-indexing all tools. Delete `toolstream.db` and restart to force a fresh index.

---

## `toolstream.routing`

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `routing.top_k` | integer | `5` | yes | Maximum number of tools surfaced automatically per conversation turn. Valid range: 1 to 50. |
| `routing.confidence_threshold` | float | `0.3` | yes | Minimum similarity score (0.0 to 1.0) for a tool to be surfaced. Tools below this score are skipped. |
| `routing.context_window_turns` | integer | `3` | yes | Number of recent conversation turns used to compute semantic similarity. Valid range: 1 to 20. |

**What goes wrong if misconfigured:**
- `top_k` too low: Claude may miss relevant tools and fall back to `discover_tools` more often. Not a correctness problem, but adds latency.
- `top_k` too high: Reduces token savings. At 50, you're approaching the "load everything" behavior ToolStream is designed to replace.
- `confidence_threshold` too high (e.g., 0.8): Very few tools get surfaced automatically. Claude will need to call `discover_tools` frequently.
- `confidence_threshold` too low (e.g., 0.05): Irrelevant tools get surfaced, wasting tokens without helping.
- `context_window_turns` too low (1): Routing only considers the most recent message, which can miss context from earlier in the conversation.

---

## `toolstream.storage`

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `storage.provider` | `"sqlite"` or `"pgvector"` | `"sqlite"` | yes | Storage backend for tool records and embeddings. |
| `storage.sqlite_path` | string | `"./toolstream.db"` | only if `provider: "sqlite"` | Path to the SQLite database file. Relative paths resolve from the working directory where ToolStream runs. |

**What goes wrong if misconfigured:**
- If `sqlite_path` points to a directory that doesn't exist, ToolStream fails at startup.
- If you move the database file and don't update `sqlite_path`, ToolStream creates a fresh empty database and re-indexes all tools on next startup (slow first boot).
- `"pgvector"` requires a PostgreSQL server with the pgvector extension installed and running. Connection details are configured separately.

---

## `servers[]`

Each entry in the `servers` list describes one upstream MCP server.

| Field | Type | Default | Required | Description |
|---|---|---|---|---|
| `servers[].id` | string | none | yes | Unique identifier for this server. Used in `discover_servers` output and as the `server` argument to `execute_tool`. Lowercase, no spaces. |
| `servers[].name` | string | none | yes | Human-readable display name. Shown in `discover_servers` output. Can include spaces. |
| `servers[].transport` | `"stdio"` or `"http"` | none | yes | How ToolStream connects to this server. Use `"stdio"` for servers launched as subprocesses. Use `"http"` for servers with their own HTTP endpoint. |
| `servers[].command` | string | none | only if `transport: "stdio"` | The executable to run. Usually `"npx"` or `"node"`. |
| `servers[].args` | string[] | `[]` | no | Arguments passed to `command`. |
| `servers[].url` | string | none | only if `transport: "http"` | The base URL of the server. Example: `"http://localhost:4000"`. |
| `servers[].auth.type` | `"none"`, `"env"`, `"bearer"`, or `"header"` | none | yes | Authentication method. |
| `servers[].auth.token_env` | string | none | only if `auth.type: "bearer"` | Name of the environment variable holding the bearer token. |
| `servers[].auth.header_name` | string | none | only if `auth.type: "header"` | Name of the HTTP header to send (e.g., `"X-API-Key"`). |

**What goes wrong if misconfigured:**
- Duplicate `id` values cause ToolStream to fail at startup with a config validation error.
- Missing `command` for a stdio server causes a startup error.
- Missing `url` for an http server causes a startup error.
- A bearer token environment variable that isn't set causes an auth error when ToolStream first connects to that server.

See [Auth Guide](auth-guide.md) for step-by-step authentication setup.
