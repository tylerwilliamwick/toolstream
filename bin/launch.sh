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

NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"
exec "$NODE_BIN" "$TOOLSTREAM_DIR/dist/index.js" start "$TOOLSTREAM_DIR/toolstream.config.local.yaml"
