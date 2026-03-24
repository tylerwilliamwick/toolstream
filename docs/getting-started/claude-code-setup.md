# Claude Code Setup

This guide walks you through connecting ToolStream to Claude Code on macOS. MCP (Model Context Protocol) is the standard that lets Claude connect to external services like GitHub and Jira. ToolStream acts as a single MCP server that manages all your other services for you. You don't need to be a developer. Each step includes what you should see to know it worked.

---

## Step 1: Complete installation

If you haven't already, follow the [Installation guide](installation.md) and confirm ToolStream runs without errors.

---

## Step 2: Note your paths

You need two file paths for the next step. Run these commands and save the output somewhere:

```bash
# Full path to the ToolStream dist file
echo "$(pwd)/dist/index.js"

# Full path to your config file
echo "$(pwd)/my-config.yaml"
```

Example output:
```
/Users/yourname/toolstream/dist/index.js
/Users/yourname/toolstream/my-config.yaml
```

Write these down. You'll paste them into Claude Code's config file in a moment.

---

## Step 3: Open Claude Code's settings file

The Claude Code settings file is at:

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Open it in a text editor. On macOS, you can run:

```bash
open -a TextEdit ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

If the file doesn't exist yet, create it with an empty JSON object:

```json
{}
```

---

## Step 4: Add ToolStream as an MCP server

Find the `mcpServers` section in the file. If it doesn't exist, add it. The full entry looks like this:

```json
{
  "mcpServers": {
    "toolstream": {
      "command": "node",
      "args": [
        "/Users/yourname/toolstream/dist/index.js",
        "/Users/yourname/toolstream/my-config.yaml"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-github-token",
        "JIRA_URL": "https://yourorg.atlassian.net",
        "JIRA_USERNAME": "you@example.com",
        "JIRA_API_TOKEN": "your-api-token",
        "CONFLUENCE_URL": "https://yourorg.atlassian.net/wiki",
        "CONFLUENCE_USERNAME": "you@example.com",
        "CONFLUENCE_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Replace the two paths with the actual paths you saved in Step 2.

The `env` block passes credentials to ToolStream. ToolStream forwards them to the services that need them automatically. Only include the credentials your services require.

If you already have other MCP server entries, add `toolstream` alongside them. But read Step 5 first.

---

## Step 5: Remove servers that ToolStream already handles

ToolStream proxies your other MCP servers, so you shouldn't have them listed twice in Claude Code. If you had entries for, say, `filesystem` or `github` that you've moved into your `my-config.yaml`, remove those entries from `claude_desktop_config.json`.

Before removing:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    },
    "toolstream": {
      "command": "node",
      "args": ["/Users/yourname/toolstream/dist/index.js", "/Users/yourname/toolstream/my-config.yaml"]
    }
  }
}
```

After removing:
```json
{
  "mcpServers": {
    "toolstream": {
      "command": "node",
      "args": ["/Users/yourname/toolstream/dist/index.js", "/Users/yourname/toolstream/my-config.yaml"]
    }
  }
}
```

---

## Step 6: Restart Claude Code

Quit Claude Code completely (Cmd+Q, not just close the window) and reopen it.

---

## Step 7: Verify the connection

Open a new Claude Code conversation. Type:

```
What MCP servers are connected?
```

Claude should respond by calling `discover_servers` and listing your servers. You might see something like:

```
I can see the following MCP servers via ToolStream:
- github (26 tools)
- obsidian (14 tools)
- mcp-atlassian (72 tools)
```

If Claude doesn't mention ToolStream or your servers, check the [Troubleshooting](../troubleshooting.md) guide.

---

## What changed

Before ToolStream, every turn of your conversation sent all tool schemas to Claude. With a modest setup of 4 MCP servers, that's often 30,000+ tokens per turn before you've said anything.

Now Claude sees 4 tools instead of hundreds. As your conversation develops, ToolStream automatically routes the relevant tools into context. You'll see the same capabilities with dramatically fewer tokens used.
