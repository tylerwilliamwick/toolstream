# Troubleshooting

## Server Not Connecting

**Symptoms:** `toolstream start` logs a warning like `Failed to connect to server 'github'`.

**Common causes:**
- The command in your config does not exist. Run the command manually in your terminal to check: `npx -y @modelcontextprotocol/server-github`
- The server package is not installed. The `-y` flag in npx should auto-install, but network issues can prevent this.
- The server requires auth that is not configured. Check that the env var listed in `token_env` is set in your current shell.

**Fix:** Run the server command directly in your terminal. If it works there but not through ToolStream, check that your shell profile exports the required env vars (they need to be available to child processes).

## Tool Not Found

**Symptoms:** The LLM calls a tool and gets `Unknown tool: <name>`.

**Common causes:**
- The tool has not been surfaced yet. ToolStream only shows tools that match the conversation context or were explicitly discovered.
- The tool name is wrong. Tool names in ToolStream are namespaced as `{server_id}_{tool_name}`. So `read_file` on the `filesystem` server becomes `filesystem_read_file`.

**Fix:** Have the LLM call `discover_tools` with a description of what it needs. This searches all registered tools and surfaces the matches.

## Slow Startup

**Symptoms:** ToolStream takes more than 10 seconds to start.

**Common causes:**
- First run downloads the embedding model (~90MB). This is a one-time cost. Subsequent starts use the cached model.
- Many upstream servers configured. Each server connection adds startup time, especially if some are slow to respond.
- An offline server is timing out. ToolStream waits for each server connection before moving on.

**Fix:** On first run, wait for the model download to complete. For offline servers, consider removing them from the config temporarily.

## Auth Errors

**Symptoms:** Tool calls return `auth_failed` with HTTP status 401.

**Common causes:**
- The token in your env var has expired. Regenerate it and update the env var.
- The env var name in your config does not match what is set in your shell. Check capitalization.
- The token does not have the right scopes. GitHub tokens need specific scopes for each API operation.

**Fix:** Verify your token works by testing it directly: `curl -H "Authorization: Bearer $YOUR_TOKEN" https://api.github.com/user`. If that works, check that the env var name in your config file matches exactly.

## Still Using Too Many Tokens

**Symptoms:** Token usage does not drop after switching to ToolStream.

**Common causes:**
- You are still connecting to the original MCP servers alongside ToolStream. Remove the individual server entries from your Claude Code config and keep only the ToolStream entry.
- `top_k` is set too high. The default of 5 surfaces ~2,500 tokens of tool schemas per turn. Setting it to 20 would surface ~10,000.
- The confidence threshold is too low. A threshold of 0.1 surfaces nearly everything that has any relevance.

**Fix:** Check your Claude Code MCP config. You should have one entry for ToolStream, not ToolStream plus the original servers. Review your `top_k` and `confidence_threshold` settings.
