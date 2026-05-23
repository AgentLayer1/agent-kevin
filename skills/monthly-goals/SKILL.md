---
name: monthly-goals
description: Set this month's themes and big-rocks goals. Lighter cadence than weekly — focus on themes that span weeks. Run on the 1st of the month or whenever feels right.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, Read, Bash
---

# Monthly Goals

Strategic, not tactical. 2-4 themes max. Each theme has a concrete success criterion you'll evaluate against next month.

## Inputs

1. **Last month's themes** — read previous `## Monthly Goals` block from `<HOME>/projects/TASKS.md` (if it exists).
2. **What landed in the last month** — task closures, knowledge commits.
3. **Active projects** — `<HOME>/projects/` directories, each project's README for vision/status.
4. **Your durable preferences** — `<HOME>/USER.md`.

## Compose

```
🗓️ Month of <Month YYYY>

📊 Last month's report card
  - <each prior theme>: <hit / partial / dropped> — <one-line evidence>

🎯 This month's themes (2-4 max)
  1. <theme name>
     - Why this matters now: <1 line>
     - Success looks like: <concrete criterion you can evaluate>
     - Primary projects: <slugs>
  2. ...

⛔ What I'm NOT doing this month
  - <intentional deferrals>
```

## Persist

Offer to update `<HOME>/projects/TASKS.md` — replace **only** the `## Monthly Goals` block inside the `<!-- GOALS:START -->...<!-- GOALS:END -->` markers with the new month's content. Leave `## Weekly Goals` and the auto-generated task-list sections outside the markers alone. Don't auto-write; confirm first.

After updating `TASKS.md`, **also persist a snapshot** via the
`mcp__plugin_agent-kevin_kevin__report_write` MCP tool so this month's themes
+ report card survive when `TASKS.md` is overwritten next month:

```
report_write({
  category: 'briefings',
  slug: 'monthly-goals',
  title: <e.g. 'Monthly goals — May 2026'>,
  skill: 'monthly-goals',
  body: <the full themes + report-card-on-prior-month block as shown to the user>,
  status: 'draft'
});
```

Surface `📄 Saved to <relPath>` to the operator alongside the TASKS.md update.

## Anti-patterns

- ❌ More than 4 themes. Monthly is for big bets, not a backlog.
- ❌ Themes that are project names ("My-project this month"). Themes are outcomes, not areas.
- ❌ Skipping the report card. Closing the loop on last month is the whole point of monthly cadence.
