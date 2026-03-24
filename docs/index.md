# ToolStream

Cut your LLM tool token usage by 90%.

ToolStream is an MCP proxy that sits between your LLM client and all your MCP servers. Instead of loading every tool schema on every turn, it surfaces only the tools that are relevant to what you're doing right now.

---

## Pick your path

**I use Claude Code and want to set it up.**
Start with [Installation](getting-started/installation.md), then follow the [Claude Code setup guide](getting-started/claude-code-setup.md).

**I'm building a custom app and want to integrate ToolStream.**
Start with [Installation](getting-started/installation.md), then read [How It Works](concepts/how-it-works.md) and the [Configuration Reference](configuration/reference.md).

---

## Why it matters

| Scenario | Before ToolStream | After ToolStream | Savings |
|---|---|---|---|
| 107 tools across 4 servers | ~32K tokens/turn | ~2.8K tokens/turn | 91% |
| 200 tools across 8 servers | ~100K tokens/turn | ~2.8K tokens/turn | 97% |

Every turn of a conversation, your LLM client sends tool schemas to the model. With 100+ tools, that's tens of thousands of tokens before you've said a word. ToolStream replaces all those schemas with 3 meta-tools, then routes the right tools into context as the conversation develops.

---

## How it works in 10 seconds

1. Your LLM client connects to ToolStream instead of individual MCP servers.
2. ToolStream connects to all your servers in the background.
3. The LLM sees only 3 tools: `discover_servers`, `discover_tools`, `execute_tool`.
4. As you talk, ToolStream automatically surfaces the tools most likely to be useful.

No capability loss. No extra API calls. No model training required.

---

## What's inside

- [Getting Started: Installation](getting-started/installation.md)
- [Getting Started: Claude Code Setup](getting-started/claude-code-setup.md)
- [Getting Started: First Config](getting-started/first-config.md)
- [Concepts: How It Works](concepts/how-it-works.md)
- [Concepts: Meta-Tools](concepts/meta-tools.md)
- [Configuration: Reference](configuration/reference.md)
- [Configuration: Examples](configuration/examples.md)
- [Configuration: Auth Guide](configuration/auth-guide.md)
- [Troubleshooting](troubleshooting.md)
