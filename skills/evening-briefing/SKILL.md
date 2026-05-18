---
name: evening-briefing
description: Tailored evening brief — what shipped today, what's still pending, what's stalled. Run at end of day to close the loop and queue up tomorrow.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_scan, Read, Glob, Bash
---

# Evening Briefing

Close the day cleanly. Show what landed, name what didn't, flag what'll bite tomorrow if you ignore it.

## Inputs

1. **What changed today** — `git -C <HOME>/knowledge log --since=midnight --oneline` and same for `<HOME>/projects`. Plus any tasks whose `updated:` is today.
2. **Closed today** — tasks with `closed:` set to today.
3. **Still open / active** — `mcp__plugin_agent-kevin_kevin__task_query` with `{status: "active"}` and `{status: "open", priority: "P0"}` / `priority: "P1"`.
4. **Stale / overdue** — `mcp__plugin_agent-kevin_kevin__task_scan` results.
5. **Last session tail** — already in your context via the SessionStart hook.

## Compose

```
🌙 Evening wrap — <weekday>, <date>

✅ Shipped today
  - <task id or commit> — <what>
  - ...

🚧 Still in motion
  - <task id>: <title> — <where you stalled / next concrete step>
  - ...

⚠️ Stalled / overdue
  - <stale or overdue items, if any>

💭 What I learned
  - <1-2 lines if a decision or insight emerged worth remembering>
  - If nothing's worth recording, skip the section

🌅 Tomorrow first move
  - <one concrete first action>
```

## Anti-patterns

- ❌ Listing every commit message. Group by what they accomplished.
- ❌ Padding the "shipped" section with already-in-progress work. Only landings.
- ❌ Restating Active Threads from memory/index.md verbatim. The brief is delta, not status quo.
