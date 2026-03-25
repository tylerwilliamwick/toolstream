# Analytics

ToolStream tracks tool usage locally so it can make smarter routing decisions over time. No data leaves your machine.

---

## What gets tracked

Every time a tool is called through ToolStream, it records:

- **Tool ID**: the server and tool name in `server:tool` format (e.g., `github:create_issue`)
- **Session ID**: which session the call belonged to
- **Timestamp**: when the call happened (Unix milliseconds)
- **Sequence position**: how many tools had been called in this session before this one (1 for the first call, 2 for the second, and so on)

This happens for both meta-tool paths (`execute_tool`) and for tools surfaced by the semantic router.

---

## Co-occurrence tracking

In addition to per-call events, ToolStream tracks which tools tend to appear together in the same session. Each time a tool is called, it's paired against every other distinct tool called in that session, and those pair counts are incremented.

The pair `(A, B)` and `(B, A)` are stored as a single row: tool IDs are sorted lexicographically before writing, so you don't get duplicate rows for the same pair.

This data isn't currently used for routing decisions, but it's exposed in `toolstream stats` so you can see which tools cluster together in practice.

---

## Database schema

Analytics data lives in two tables inside the SQLite database:

**`tool_call_events`**

| Column | Type | Description |
|---|---|---|
| `tool_id` | TEXT | Server and tool name: `server:tool` |
| `session_id` | TEXT | UUID of the session that made the call |
| `timestamp` | INTEGER | Unix milliseconds |
| `sequence_position` | INTEGER | Call order within the session (1-indexed) |

**`tool_cooccurrence`**

| Column | Type | Description |
|---|---|---|
| `tool_a_id` | TEXT | First tool in the pair (lexicographically smaller ID) |
| `tool_b_id` | TEXT | Second tool in the pair |
| `count` | INTEGER | Number of sessions where both tools were called |
| `last_seen_at` | INTEGER | When this pair last co-occurred (Unix milliseconds) |

Both tables have indexes on `tool_id`, `session_id`, and `timestamp` for fast aggregation queries.

---

## Data retention

By default, ToolStream deletes `tool_call_events` rows older than 30 days on startup. This keeps the database from growing unbounded over time.

The 30-day TTL is hardcoded in `src/cli/start.ts` and calls `db.pruneOldEvents(30)`. The co-occurrence table isn't pruned on the same schedule since it stores aggregated counts rather than individual events.

---

## `toolstream stats`

The `stats` command reads from the database and prints two tables.

```
toolstream stats
```

**Options:**

| Flag | Default | Description |
|---|---|---|
| `--limit N` | 10 | How many rows to show per table |
| `--json` | false | Output raw JSON instead of formatted tables |
| `--db-path PATH` | `./toolstream.db` | Path to the database file |

**Example output:**

```
Top Tools by Call Count
======================

  #  Tool                                      Calls
  -------------------------------------------------
  1  github:create_issue                           47
  2  filesystem:read_file                          38
  3  jira:get_issue                                31

Top Co-occurring Tool Pairs
==========================

  #  Tool A                          Tool B                          Count
  -----------------------------------------------------------------------
  1  filesystem:read_file            filesystem:write_file              24
  2  github:create_issue             github:list_issues                 18
  3  jira:get_issue                  jira:add_comment                   14
```

With `--json`, the output is:

```json
{
  "topTools": [
    { "tool_id": "github:create_issue", "call_count": 47 },
    ...
  ],
  "topCooccurrence": [
    { "tool_a_id": "filesystem:read_file", "tool_b_id": "filesystem:write_file", "count": 24 },
    ...
  ]
}
```

---

## Privacy

All analytics data stays in the local SQLite database. ToolStream doesn't send usage data anywhere. If you want to disable analytics entirely, you can delete or replace the `db` instance passed to `ProxyServer` in your setup, though there's no config flag for this yet.
