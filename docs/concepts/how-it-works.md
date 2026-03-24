# How It Works

ToolStream sits between your LLM client and your MCP servers. It proxies all tool calls, but the key thing it does is control which tool schemas the LLM sees at any given moment.

---

## The problem it solves

Every time an LLM client sends a message, it includes the full schema for every available tool. With 10 tools, that's manageable. With 100+ tools spread across Jira, GitHub, filesystem, Slack, and other servers, you're sending 30,000 to 100,000 tokens of tool definitions before you've typed a word.

ToolStream replaces that constant overhead with a small fixed cost: 3 meta-tool schemas, always.

---

## The 4-step flow

### Step 1: Connect

Your LLM client (Claude Code, or your custom app) connects to ToolStream as if it were a single MCP server. ToolStream, in turn, connects to all your upstream MCP servers at startup.

```
LLM Client <---> ToolStream <---> [Filesystem Server]
                                  [GitHub Server]
                                  [Jira Server]
                                  [Slack Server]
```

The LLM client doesn't know about the individual servers. It only sees ToolStream.

### Step 2: Meta-tools

When the LLM client asks "what tools do you have?", ToolStream returns exactly 3:

- `discover_servers`: list all upstream servers
- `discover_tools`: search for tools by natural language
- `execute_tool`: call any tool by name, even without discovering it first

These 3 schemas are tiny. A typical turn now costs ~800 tokens in tool definitions instead of 30,000+.

### Step 3: Semantic routing

As the conversation progresses, ToolStream reads the recent context. It converts the conversation into a semantic vector and compares it against vectors it computed for every tool description at startup.

The tools with the highest similarity scores get surfaced automatically. If you're talking about reading a file, the filesystem tools score high. If you're discussing a GitHub PR, the GitHub tools score high.

Surfaced tools get appended to the meta-tools list for that turn. The LLM sees them without having to ask.

You control how many tools get surfaced per turn (`top_k`), the minimum similarity score required (`confidence_threshold`), and how many conversation turns to consider (`context_window_turns`). See [Configuration Reference](../configuration/reference.md).

### Step 4: Fallback discovery

If ToolStream's automatic routing misses something, the LLM has explicit escape hatches:

- Call `discover_tools` with a natural language query to search for the right tool.
- Call `execute_tool` directly with a server ID and tool name if you already know what you need.

This means no capability is ever hidden. The LLM can always find and use any tool; it just doesn't pay the token cost of loading all schemas upfront.

---

## Embeddings: how semantic routing works

At startup, ToolStream takes every tool's name and description and converts it into a vector (a list of numbers). These vectors capture the semantic meaning of what each tool does.

When a new conversation turn arrives, ToolStream does the same thing to the recent conversation text. Then it measures how similar the conversation vector is to each tool vector. The most similar tools get surfaced.

This all runs locally using the `all-MiniLM-L6-v2` model. No external API calls, no per-embedding cost.

---

## What ToolStream doesn't do

- It doesn't modify tool arguments or results. Calls pass through unchanged.
- It doesn't cache results. Every tool call reaches the upstream server.
- It doesn't decide which tools are "better." It routes by semantic similarity, not judgment.
- It doesn't require you to annotate or tag your tools. It works with any MCP server out of the box.
