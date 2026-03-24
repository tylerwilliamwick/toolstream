# Deployment

This page covers three ways to run ToolStream: as a Claude Code MCP server, as a standalone process, and as a persistent macOS background service via LaunchAgent.

---

## As a Claude Code MCP server

This is the most common setup. Claude Code manages the ToolStream process lifecycle.

Add ToolStream to your Claude Code settings file at:

```
~/Library/Application Support/Claude/claude_desktop_config.json
```

```json
{
  "mcpServers": {
    "toolstream": {
      "command": "node",
      "args": [
        "/path/to/toolstream/dist/index.js",
        "/path/to/toolstream/my-config.yaml"
      ]
    }
  }
}
```

Replace both paths with your actual paths. Claude Code starts and stops ToolStream automatically with the app.

Remove any individual MCP server entries that ToolStream already proxies. Having them in both places creates duplicate connections.

For the full walkthrough, see [Claude Code Setup](getting-started/claude-code-setup.md).

---

## Standalone with the start command

Run ToolStream directly from the terminal:

```bash
node dist/index.js start my-config.yaml
```

This starts the proxy on stdio and blocks until you kill it. Use this for testing or when you want direct control over the process.

If your config references environment variables for secrets (tokens, API keys), set them before running:

```bash
export GITHUB_TOKEN="ghp_..."
node dist/index.js start my-config.yaml
```

---

## LaunchAgent on macOS

A LaunchAgent keeps ToolStream running in the background, starts it at login, and restarts it if it crashes. Use this when you want ToolStream always available without needing Claude Code open.

### Step 1: Create the plist file

Create `~/Library/LaunchAgents/com.toolstream.proxy.plist` with this content, adjusting paths to match your setup:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.toolstream.proxy</string>

  <key>ProgramArguments</key>
  <array>
    <string>/path/to/toolstream/bin/launch.sh</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/Users/yourname/.toolstream/logs/toolstream.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/yourname/.toolstream/logs/toolstream-error.log</string>
</dict>
</plist>
```

### Step 2: Create the log directory

```bash
mkdir -p ~/.toolstream/logs
```

### Step 3: Load the agent

```bash
launchctl load ~/Library/LaunchAgents/com.toolstream.proxy.plist
```

Verify it started:

```bash
launchctl list | grep toolstream
```

You should see a line with `com.toolstream.proxy` and a process ID (not a dash) in the PID column.

---

## Using bin/launch.sh for secret injection

The `bin/launch.sh` wrapper handles secrets before starting the node process. It does two things:

1. Sources a `.env` file of your choice (edit the script to point at your credentials file) for any env vars your upstream servers need.
2. Reads your GitHub Personal Access Token from the macOS Keychain (using the `github-pat` keychain item) and falls back to the existing environment variable if the keychain lookup fails.

Point your LaunchAgent at `bin/launch.sh` rather than calling `node` directly. This keeps secrets out of your plist file.

To store your GitHub token in the Keychain:

```bash
security add-generic-password -s github-pat -a "$USER" -w "ghp_your_token_here"
```

---

## Rollback: unload the LaunchAgent

To stop ToolStream and remove it from autostart:

```bash
launchctl unload ~/Library/LaunchAgents/com.toolstream.proxy.plist
```

To restart it after making config changes:

```bash
launchctl unload ~/Library/LaunchAgents/com.toolstream.proxy.plist
launchctl load ~/Library/LaunchAgents/com.toolstream.proxy.plist
```

---

## Log locations

| Log | Path |
|-----|------|
| Standard output | `~/.toolstream/logs/toolstream.log` |
| Standard error | `~/.toolstream/logs/toolstream-error.log` |

Tail the log to watch live output:

```bash
tail -f ~/.toolstream/logs/toolstream.log
```

Log rotation is not handled by ToolStream itself. The logs grow until you rotate or truncate them. If disk space is a concern, set up `newsyslog` or a cron job to rotate them periodically.
