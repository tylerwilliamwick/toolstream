#!/bin/bash
# Toolstream LaunchAgent wrapper
# Sources secrets from telegram-assistant .env and launches Toolstream

# Source Telegram bot credentials
if [ -f "$HOME/telegram-assistant/.env" ]; then
  set -a
  source "$HOME/telegram-assistant/.env"
  set +a
fi

# GitHub token from macOS Keychain (fallback to env)
if [ -z "$GITHUB_PERSONAL_ACCESS_TOKEN" ]; then
  GITHUB_PERSONAL_ACCESS_TOKEN="$(security find-generic-password -s github-pat -w 2>/dev/null || echo '')"
  export GITHUB_PERSONAL_ACCESS_TOKEN
fi

exec /opt/homebrew/bin/node /Users/tylerwick/projects/toolstream/dist/index.js start /Users/tylerwick/projects/toolstream/toolstream.config.yaml
