#!/bin/bash
# Toolstream LaunchAgent wrapper
# Sources credentials and launches Toolstream

TOOLSTREAM_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Source your credentials, e.g.:
#   source ~/.config/toolstream/.env
# Or load from a .env file next to this script:
#   source "$TOOLSTREAM_DIR/.env"

# Ensure HOME is set (required for macOS Keychain access in LaunchAgent context)
export HOME="${HOME:-/Users/tylerwick}"

# Ensure PATH includes Homebrew and Python so upstream servers (npx, uvx, node) resolve
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

# GitHub token from macOS Keychain (fallback to env)
if [ -z "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
  GITHUB_PERSONAL_ACCESS_TOKEN="$(security find-generic-password -s github-pat -w 2>/dev/null || echo '')"
  export GITHUB_PERSONAL_ACCESS_TOKEN
fi

# Enable all tool sets for mcp-atlassian v0.22.0+ (prevents 72→6 tool drop)
export TOOLSETS="${TOOLSETS:-all}"

NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"

# Crash loop protection: if 5 crashes occur within 60s, sleep 300s
CRASH_LOG="${TMPDIR:-/tmp}/toolstream_crash_timestamps.log"
CRASH_THRESHOLD=5
CRASH_WINDOW=60
CRASH_SLEEP=300

while true; do
  "$NODE_BIN" "$TOOLSTREAM_DIR/dist/index.js" start "$TOOLSTREAM_DIR/toolstream.config.local.yaml"
  EXIT_CODE=$?

  # Record crash timestamp
  date +%s >> "$CRASH_LOG"

  # Count crashes within the window
  NOW=$(date +%s)
  CUTOFF=$((NOW - CRASH_WINDOW))
  RECENT=$(awk -v c="$CUTOFF" '$1 >= c' "$CRASH_LOG" 2>/dev/null | wc -l | tr -d ' ')

  if [ "${RECENT}" -ge "${CRASH_THRESHOLD}" ]; then
    echo "[launch.sh] Crash loop detected (${RECENT} crashes in ${CRASH_WINDOW}s). Sleeping ${CRASH_SLEEP}s..." >&2
    # Truncate log so next window starts fresh after sleep
    > "$CRASH_LOG"
    sleep "$CRASH_SLEEP"
  fi

  # Exit 0 means intentional shutdown (SIGTERM/SIGINT), don't restart
  if [ "$EXIT_CODE" -eq 0 ]; then
    exit 0
  fi
done
