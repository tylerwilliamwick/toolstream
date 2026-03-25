# Session Routing

Each connection from an LLM client gets its own session. ToolStream uses session state to pre-load relevant tools at startup and to bias routing toward servers you've been using recently.

---

## Sessions

When the LLM client first calls `tools/list` or `tools/call`, ToolStream creates a session and assigns it a UUID. That session persists in memory until it goes idle for 5 minutes, at which point it's cleaned up.

Sessions hold:

- The **active surface**: tools currently visible to the LLM
- The **context buffer**: recent conversation turns used for semantic routing (capped at 6 by default)
- **Server call counts**: a running tally of how many times each upstream server's tools have been called

Sessions are also persisted to SQLite (`sessions` table) so the database reflects recent activity, but the in-memory state is authoritative during a live session.

---

## Popularity pre-loading

At session creation, ToolStream checks the analytics database for the top tools by all-time call count and surfaces them immediately, before any routing has happened.

The default is 3 tools. You can change this with `routing.popularity_preload_count` in your config:

```yaml
toolstream:
  routing:
    popularity_preload_count: 5
```

Set it to `0` to disable pre-loading.

These tools get surfaced with a score of `1.0` and a source of `"startup"`. The LLM sees them on the very first `tools/list` call, alongside the 4 meta-tools.

This is useful for tools you call in nearly every session. If `filesystem:read_file` is your most-used tool, it'll be ready without a discover step.

---

## Multi-turn topic tracking

As you call tools in a session, ToolStream counts how many calls went to each upstream server. This builds a picture of what you're working on.

For example: if you call `jira:get_issue`, `jira:add_comment`, and `jira:update_issue` in a row, the `jira` server's count is 3. If you then call one `github` tool, `jira` is still dominant with 3 vs. 1.

The session resets its topic state if 3 or more consecutive calls go to a server other than the current dominant one. This handles topic shifts cleanly: switching from a Jira workflow to a GitHub workflow resets the counts and starts fresh.

**Minimum threshold:** topic context is only surfaced to the router after at least 3 total tool calls in the session. Before that, there's not enough signal to establish a topic.

---

## How topic bias affects routing

When the semantic router scores tool candidates, it receives the session's topic context alongside the query vector. If there's a dominant server and its confidence is above 0.5, all tools from that server get a 30% score boost:

```
adjusted_score = original_score * 1.3
```

Candidates are re-ranked after the boost, so a Jira tool with a score of 0.65 would be treated as 0.845 if `jira` is the dominant server with >50% confidence.

The boost doesn't change which tools are in the candidate set; it only changes their order. Tools from other servers can still win if their semantic similarity is high enough.

**Example:** you've been working with Jira tools for most of a session and then ask about "searching for open items." Both `jira:search_issues` and `github:search_issues` might score 0.72 on the query. After the 1.3x bias, `jira:search_issues` scores 0.936 and lands at the top. Without the bias, the two would tie and the sort order would be arbitrary.

---

## Confidence calculation

Confidence is the fraction of session calls that went to the dominant server. If you've made 6 calls and 4 went to `jira`, confidence is `4/6 = 0.67`. Since that's above 0.5, the bias applies.

If calls are split roughly evenly across servers (say 3 servers with 2 calls each), no single server has >50% confidence and no bias is applied.
