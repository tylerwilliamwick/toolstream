# Self-Healing: Auto-Reconnection and Health Checks

If one of your connected services goes offline, ToolStream notices within 60 seconds and starts trying to reconnect on its own. It tries up to 10 times, waiting longer between each attempt. If it cannot reconnect after 10 tries, it stops retrying and sends you a Telegram alert (if you have notifications configured). You don't need to do anything; this is all automatic.

The rest of this page covers the technical details of how this works.

---

## How auto-reconnection works

Each upstream connection uses a stdio transport. Two event handlers watch for failure:

- `transport.onclose` fires when the child process exits or the connection closes unexpectedly.
- `transport.onerror` fires when the transport encounters an error on an active connection.

Either event marks the server as unhealthy and schedules a reconnect.

Reconnection uses exponential backoff starting at 1 second, doubling each attempt, capped at 30 seconds:

| Attempt | Delay |
|---------|-------|
| 1 | 1s |
| 2 | 2s |
| 3 | 4s |
| 4 | 8s |
| 5 | 16s |
| 6–10 | 30s |

The maximum is 10 attempts. If all 10 fail, ToolStream marks the server permanently failed and fires a `server_permanently_failed` event (which triggers a Telegram notification if configured).

A guard flag (`reconnecting: true`) prevents multiple concurrent reconnect loops for the same server. If the transport fires `onclose` while a reconnect is already in progress, the new trigger is ignored.

---

## Health check ping loop

Separately from the transport event handlers, the `HealthMonitor` runs a periodic ping loop:

- **Interval:** every 60 seconds
- **Timeout:** 10 seconds per ping (a ping that doesn't respond within 10 seconds counts as a failure)

The ping uses the MCP `ping` RPC method directly on the connected client. On each 60-second tick, ToolStream pings every configured server in sequence.

The ping loop and the transport reconnect loop are coordinated. Before triggering a reconnect from a failed ping, ToolStream checks whether a reconnect is already in progress. If `reconnecting` is true, the ping loop skips scheduling another reconnect cycle.

---

## What happens when a server goes down

1. The transport fires `onclose` or `onerror`, or the ping loop times out.
2. The server is marked `healthy: false`.
3. If no reconnect is already running, a reconnect sequence starts with exponential backoff.
4. A `server_down` event fires. If Telegram notifications are configured for `server_down`, a message goes out.
5. Each reconnect attempt tears down the old transport, creates a new one, and calls `client.connect()`.
6. If the attempt throws, the next attempt is scheduled at the next backoff delay.
7. After 10 failed attempts, the server is marked permanently failed and no further reconnects are scheduled.

---

## What happens when a server recovers

Two paths lead to recovery:

**Transport reconnect succeeds:** `client.connect()` returns without throwing. The connection is updated in place: the old client and transport are replaced, `healthy` is set to `true`, and `reconnecting` is set to `false`. Tool sync runs immediately after reconnect.

**Ping succeeds on an unhealthy server:** If the ping loop finds a server where `healthy` is `false` but the ping call succeeds (meaning the transport came back on its own), `healthy` is set to `true` and a `server_recovered` event fires.

In both cases, tool sync runs after recovery. The sync calls `client.listTools()` and registers the results in the tool registry. Tools that already have embeddings in the database are not re-embedded; only new tools trigger embedding generation. This keeps recovery fast.

---

## Summary of events

| Event | When | Triggers notification |
|-------|------|-----------------------|
| `server_down` | Ping fails or transport closes | Yes (if configured) |
| `server_recovered` | Ping succeeds on previously unhealthy server | Yes (if configured) |
| `server_permanently_failed` | 10 reconnect attempts exhausted | Yes (if configured) |
| `ping_success` | Ping succeeds (internal only) | No |
| `ping_failed` | Ping fails (internal only) | No |
