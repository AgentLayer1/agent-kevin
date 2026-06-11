---
name: monthly-goals
description: Set this month's themes and big-rocks goals — reads the full task board + last 2 weeks of sessions, then interviews you (2-3 rounds) before drafting themes. Run on the 1st of the month or whenever feels right.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, AskUserQuestion, Read, Bash
---

# Monthly Goals

Strategic, not tactical. 2-4 themes max. Each theme has a concrete success criterion you'll evaluate against next month.

## Inputs

1. **Last month's themes** — read previous `## Monthly Goals` block from `<HOME>/projects/TASKS.md` (if it exists).
2. **What landed in the last month** — task closures, knowledge commits.
3. **Full task board** — `mcp__plugin_agent-kevin_kevin__task_query` across **all** statuses and priorities. Blocked chains, stale P1s, and the P3 graveyard say as much about the month ahead as the active list does.
4. **Recent sessions** — read the last ~2 weeks of daily memory files (`<HOME>/knowledge/memory/YYYY-MM-DD.md`); skim `<HOME>/knowledge/raw/sessions/` day files where memory is thin. Where attention actually went last month is the honest baseline for what next month's themes can realistically claim.
5. **Active projects** — `<HOME>/projects/` directories, each project's README for vision/status.
6. **Your durable preferences** — `<HOME>/USER.md`.

## Interview

Monthly themes are strategic — they cross weeks and bind multiple projects. Context surfaces the projects and recent closures but not the operator's current strategic intent. This is an **interview, not a single question round** — run 2-3 rounds of `AskUserQuestion` and don't draft themes until each one traces to an answer the operator actually gave.

**Round 1 — orient.** Calibrate the month's shape:

- **Theme candidates** — derive 3-5 plausible themes from the full board + recent sessions + last month's drops and ask which 2-4 to commit to (`multiSelect: true`). Each option labeled with a one-line outcome, not a project name.
- **Bet direction** — when projects pull in different directions (e.g. shipping vs. building vs. learning vs. family), ask which gets the month's gravity.
- **Big external dates** — surface known deadlines/events landing in the month and confirm which actually shape priorities.

**Round 2 — grill.** Built from round-1 answers + what the inputs exposed. Challenge, don't transcribe:

- **Report-card honesty** — for each prior theme that session evidence shows slipped, ask why before letting a successor theme in: "Last month <theme> got ~2 sessions of attention. What changes this month, or does it go?"
- **Attention vs. intent** — "Sessions last month clustered on <X>, but none of your picked themes cover it. Is <X> a theme, a distraction, or done?"
- **Success-criterion pressure** — for each chosen theme, propose a concrete pass/fail criterion and make them accept, sharpen, or reject it. A theme without a falsifiable criterion doesn't ship.
- **Stop-doing** — ask what to consciously NOT pursue this month, especially areas where the operator usually drifts (the board's stale list names them).

**Round 3 (if needed) — converge.** Only when round 2 left a real conflict (two themes claiming the same capacity, or a criterion the operator won't commit to). Otherwise draft.

Skip questions whose answer is plain from context (e.g. don't ask about a theme that's been the obvious anchor for weeks). One sharp question beats three generic ones — but one round is almost never enough.

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
- ❌ Skipping the Interview step. Monthly is strategic; the operator's head holds context the task system doesn't.
- ❌ Stopping after one polite round. If no answer forced a theme to change, you confirmed instead of grilled.
- ❌ Generic questions ("what's important this month?"). Anchor every question in something context already surfaced.
