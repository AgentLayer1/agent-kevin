---
name: weekly-goals
description: Set this week's goals — wins from last week, in-flight surface, what to tackle, what to defer. Writes the goals block in TASKS.md. Run on Sunday or Monday.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__task_create, AskUserQuestion, Read, Write, Edit, Glob, Bash
---

# Weekly Goals

A short, decisive weekly plan. Aim for 3-5 goals, not 15. Quality of focus beats volume.

## Inputs

1. **Wins last 7 days** — tasks with `closed:` in the last week, commits to knowledge + projects.
2. **In-flight** — `mcp__plugin_agent-kevin_kevin__task_query` with `{status: "active"}`.
3. **Backlog signal** — `{status: "open"}` filtered to P0 + P1.
4. **Stale / overdue** — `mcp__plugin_agent-kevin_kevin__task_scan`.
5. **Active threads + pending** — `<HOME>/knowledge/memory/index.md`.

## Ask

Context alone misses what's in the operator's head. After gathering inputs, ask **2-3 targeted questions** via `AskUserQuestion` to ground the draft in their actual intent. Don't ask generic "what are your goals" — ask sharp questions that close the gap between what context shows and what only they know.

Tailor questions to what the context actually surfaces. Patterns that work:

- **Capacity check** — "How much real focus time do you have this week (light / normal / heavy)?" — calibrates how many goals to propose.
- **Energy direction** — present 2-4 candidate goals derived from in-flight + P0/P1 backlog and ask which to anchor on (`multiSelect: true` when stacking is fine).
- **External constraints** — surface anything that looks like a hard deadline or commitment in context and confirm: "Is the <X> deadline real for this week, or can it slip?"
- **Deferral** — when 5+ items compete, ask which to explicitly NOT do.

Skip questions whose answer is already obvious from context. One sharp question beats three generic ones.

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

After updating `TASKS.md`, **also persist a snapshot** via the
`mcp__plugin_agent-kevin_kevin__report_write` MCP tool so this week's goals
survive when `TASKS.md` is overwritten next Sunday:

```
report_write({
  category: 'briefings',
  slug: 'weekly-goals',
  title: <e.g. 'Weekly goals — Week of 2026-05-25'>,
  skill: 'weekly-goals',
  body: <the full goals block + wins/in-flight/defer rationale as shown to the user>,
  status: 'draft'
});
```

Surface `📄 Saved to <relPath>` to the operator alongside the TASKS.md update.

## Anti-patterns

- ❌ More than 5 goals. If you can't pick, you're not deciding.
- ❌ Vague goals like "make progress on X". Every goal is a concrete deliverable.
- ❌ Carrying everything in-flight as a goal. Some of it should be deferred or closed.
- ❌ Skipping the Ask step and drafting straight from context. Context shows what's on the board; only the operator knows what they actually want to push this week.
- ❌ Generic questions ("what are your priorities?"). Ask sharp, context-anchored questions or don't ask.
