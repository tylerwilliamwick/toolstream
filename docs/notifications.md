# Notifications: Telegram Alerts

ToolStream can send messages to a Telegram chat when servers go down, recover, or fail to start. This page covers setup, configuration, and how the throttle works.

---

## Create a Telegram bot

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the prompts to name your bot.
3. BotFather will give you a token in the format `1234567890:ABCDEFabcdef...`. Save it.
4. Start a chat with your new bot (search for it by username and press Start).
5. Get your chat ID by visiting this URL in a browser, replacing `YOUR_TOKEN`:

   ```
   https://api.telegram.org/botYOUR_TOKEN/getUpdates
   ```

   Send your bot a message first, then load that URL. Find `"chat":{"id":` in the response. That number is your chat ID.

---

## Configure in toolstream.config.yaml

Add a `notifications` section under `toolstream`:

```yaml
toolstream:
  notifications:
    telegram:
      bot_token: "1234567890:ABCDEFabcdef..."
      chat_id: "987654321"
      events:
        - server_down
        - server_recovered
        - startup_failure
      throttle_seconds: 300
```

Field reference:

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `bot_token` | Yes | none | The token from BotFather |
| `chat_id` | Yes | none | Your Telegram chat ID |
| `events` | No | `["server_down", "server_recovered"]` | Which events send notifications |
| `throttle_seconds` | No | `300` | Minimum seconds between notifications for the same event type |

---

## Environment variables

You can keep secrets out of your config file by referencing environment variables:

```yaml
toolstream:
  notifications:
    telegram:
      bot_token: "$TELEGRAM_BOT_TOKEN"
      chat_id: "$TELEGRAM_CHAT_ID"
```

Then set the variables before starting ToolStream:

```bash
export TELEGRAM_BOT_TOKEN="1234567890:ABCDEFabcdef..."
export TELEGRAM_CHAT_ID="987654321"
node dist/index.js my-config.yaml
```

If you use `bin/launch.sh`, it sources credentials from `~/telegram-assistant/.env` automatically. See [Deployment](deployment.md) for details.

---

## Event types

| Event | When it fires |
|-------|---------------|
| `server_down` | A server's ping fails or its transport closes unexpectedly |
| `server_recovered` | A server that was down responds to a ping successfully |
| `auto_heal_triggered` | A reconnect sequence starts for a failed server |
| `startup_failure` | ToolStream encounters a fatal error during startup |

You can subscribe to any subset. Only events listed in the `events` array send notifications.

---

## Throttle behavior

Throttling is per event type. If ToolStream sends a `server_down` notification for server `github`, it won't send another `server_down` notification for any server until `throttle_seconds` have elapsed. The clock resets after each sent notification.

A failed send (network error, bad token) does not count against the throttle. The throttle only advances when a message is delivered successfully.

Default throttle is 300 seconds (5 minutes).

---

## Startup health check

When ToolStream starts and Telegram is configured, it sends a test message:

```
Toolstream started. Telegram notifications active.
```

If this message sends successfully, notifications are enabled. If the send fails (invalid token, no network, wrong chat ID), ToolStream logs a warning and disables notifications for the session. No notifications will fire until you restart with working credentials.

This means you'll know immediately at startup whether your Telegram setup is working.

---

## Message format examples

**Server down:**
```
🔴 Toolstream: Server 'github' DOWN
Time: 3/24/2026, 9:14:02 AM
Error: Ping timeout
Action: Auto-reconnect in progress (attempt 1/10)
```

**Server recovered:**
```
🟢 Toolstream: Server 'github' RECOVERED
Time: 3/24/2026, 9:15:47 AM
Ping: 43ms
```

**Startup failure:**
```
🔴 Toolstream: STARTUP FAILURE
Time: 3/24/2026, 9:00:01 AM
Error: Config error at 'servers[0].command': Required for stdio transport
```

Messages use HTML parse mode. Times are displayed in US Pacific timezone.
