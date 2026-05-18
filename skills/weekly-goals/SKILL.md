---
name: weekly-goals
description: Set this week's goals — wins from last week, in-flight surface, what to tackle, what to defer. Writes the goals block in TASKS.md. Run on Sunday or Monday.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__task_create, Read, Write, Edit, Glob, Bash
---

# Weekly Goals

A short, decisive weekly plan. Aim for 3-5 goals, not 15. Quality of focus beats volume.

## Inputs

1. **Wins last 7 days** — tasks with `closed:` in the last week, commits to knowledge + projects.
2. **In-flight** — `mcp__plugin_agent-kevin_kevin__task_query` with `{status: "active"}`.
3. **Backlog signal** — `{status: "open"}` filtered to P0 + P1.
4. **Stale / overdue** — `mcp__plugin_agent-kevin_kevin__task_scan`.
5. **Active threads + pending** — `<HOME>/knowledge/memory/index.md`.

## Compose

Output to the user as a draft, then offer to write it into `<HOME>/projects/TASKS.md`.

```
🎯 Week of <YYYY-MM-DD>

✅ Last week
  - <up to 5 bullets of what landed>

🔄 In flight (carrying over)
  - <project>: <task id> — <where it stands>

🚀 This week (3-5 goals max)
  1. <project>: <concrete deliverable + why this week>
  2. ...

🚫 Explicitly NOT this week
  - <projects/tasks I'm deferring on purpose>
```

## Persist

If the user confirms, edit `<HOME>/projects/TASKS.md` and **replace only the `## Weekly Goals` block inside the `<!-- GOALS:START -->...<!-- GOALS:END -->` markers**. Leave `## Monthly Goals` (also inside the markers) and everything outside the markers untouched — the task-list sections are auto-rebuilt by Kevin and will be overwritten on the next mutation.

Replace from `## Weekly Goals` up to (but not including) the next `##` heading or `<!-- GOALS:END -->` with:

```markdown
## Weekly Goals — Week of <YYYY-MM-DD>

<the "This week" block above>

_Set <YYYY-MM-DD>. Next review: <next Sunday>._
```

## Anti-patterns

- ❌ More than 5 goals. If you can't pick, you're not deciding.
- ❌ Vague goals like "make progress on X". Every goal is a concrete deliverable.
- ❌ Carrying everything in-flight as a goal. Some of it should be deferred or closed.
