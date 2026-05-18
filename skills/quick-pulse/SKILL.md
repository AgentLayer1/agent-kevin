---
name: quick-pulse
description: Quick scan — anything stalled, any recent errors, any tasks past their cadence. ~1 minute read. Use when you want a status check without a full briefing.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_scan, Read, Glob, Bash
---

# Quick Pulse

A 60-second check. Surface anything that needs attention; otherwise say so plainly.

## Inputs

1. `mcp__plugin_agent-kevin_kevin__task_scan` — overdue, stale, blocked, priority bumps.
2. `mcp__plugin_agent-kevin_kevin__task_query` with `{status: "active"}` — verify nothing's been "active" for >7 days without movement.
3. `<HOME>/knowledge/memory/index.md` `## Active Threads` — anything still listed that should be closed?

## Compose

```
🩺 Pulse

<one of these:>
  - ✅ All clear — <N> active tasks, no overdue, no stale, nothing flagged.
  - ⚠️ Needs attention:
      - <specific item + suggested action>
      - ...
```

That's it. Don't pad. If everything's fine, the one-line "all clear" is the right output.

## Anti-patterns

- ❌ Restating active threads or upcoming tasks. That's morning-briefing's job.
- ❌ Generic "consider reviewing X" suggestions. Specific or skip.
