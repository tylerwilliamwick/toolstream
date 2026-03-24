# Meta-Tools

ToolStream always exposes exactly 3 tools to the LLM, regardless of how many upstream servers or tools are configured. These meta-tools give the LLM full visibility and control without loading every schema upfront.

---

## `discover_servers`

Lists all upstream MCP servers registered with ToolStream, including their IDs and tool counts.

**When to use it:** when you want to understand what capabilities are available, or when you're not sure which server handles a particular type of task.

**Input:** none

**Example call:**
```json
{}
```

**Example output:**
```json
[
  {
    "id": "filesystem",
    "name": "Filesystem Server",
    "transport": "stdio",
    "toolCount": 12,
    "lastSyncedAt": 1711234567890
  },
  {
    "id": "github",
    "name": "GitHub MCP Server",
    "transport": "stdio",
    "toolCount": 31,
    "lastSyncedAt": 1711234567891
  }
]
```

Use the `id` field when calling `execute_tool`.

---

## `discover_tools`

Searches all tool descriptions using a natural language query. Returns the most relevant tools ranked by semantic similarity.

**When to use it:** when the automatically surfaced tools don't include what you need. Describe what you want to do in plain language.

**Input:**

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Natural language description of what you want to do |
| `top_k` | number | no | Max tools to return. Defaults to 10 |

**Example call:**
```json
{
  "query": "create a new GitHub issue",
  "top_k": 5
}
```

**Example output:**
```json
[
  {
    "serverId": "github",
    "toolName": "create_issue",
    "description": "Create a new issue in a GitHub repository",
    "score": 0.91
  },
  {
    "serverId": "github",
    "toolName": "create_pull_request",
    "description": "Create a new pull request",
    "score": 0.72
  }
]
```

The `score` is the semantic similarity score, from 0 to 1. Higher is more relevant.

After calling `discover_tools`, you can call the returned tools using `execute_tool` with the `serverId` and `toolName` from the results.

---

## `execute_tool`

Calls any tool on any server directly by name. This bypasses the discovery step entirely. Use it when you already know the server ID and tool name.

**When to use it:** when you know exactly which tool you need, or as a direct follow-up after calling `discover_tools`.

**Input:**

| Field | Type | Required | Description |
|---|---|---|---|
| `server` | string | yes | Server ID from `discover_servers` |
| `tool` | string | yes | Tool name on that server |
| `arguments` | object | yes | Arguments to pass to the tool |

**Example call:**
```json
{
  "server": "github",
  "tool": "create_issue",
  "arguments": {
    "owner": "my-org",
    "repo": "my-repo",
    "title": "Fix the login bug",
    "body": "Steps to reproduce..."
  }
}
```

**Example output:**

The output is whatever the upstream tool returns. ToolStream passes it through unchanged.

```json
{
  "id": 42,
  "number": 42,
  "title": "Fix the login bug",
  "html_url": "https://github.com/my-org/my-repo/issues/42",
  "state": "open"
}
```

---

## How they work together

A typical flow might look like this:

1. ToolStream automatically surfaces `read_file` and `write_file` because you're talking about editing a document.
2. You realize you need to commit the file to GitHub, but no GitHub tools were surfaced.
3. The LLM calls `discover_tools` with query `"commit a file to GitHub"`.
4. Results come back: `create_or_update_file` on the `github` server.
5. The LLM calls `execute_tool` with `server: "github"`, `tool: "create_or_update_file"`, and the file arguments.

At no point did all 31 GitHub tool schemas load. Only the one that was needed.
