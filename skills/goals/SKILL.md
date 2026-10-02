---
name: goals
description: >
  Goals from today to the year, written to the goal blocks in TASKS.md; the focus skill plans the days
  around them. Day: one to three outcomes for today, scored at night. Week: set on Monday (quick, or a
  2-3 round interview) with each goal's task planned for the week, and scored on Friday. Month: themes with a success check and a report card on
  the last month. Year: outcomes quarter by quarter. Triggers on "set today's goals", "what should
  today achieve", "plan the week", "set my weekly goals", "score the week", "monthly goals", "this
  month's themes", "set this year's goals", "yearly goals", or /goals.
allowed-tools: mcp__plugin_agent-kevin_kevin__focus_write, mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__task_create, mcp__plugin_agent-kevin_kevin__task_update, mcp__plugin_agent-kevin_kevin__report_write, AskUserQuestion, Read, Write, Edit, Glob, Bash
---

# Goals

> **Plugin root.** Claude Code fills in `CLAUDE_PLUGIN_ROOT`; Codex leaves it unset. Under Codex, read every `CLAUDE_PLUGIN_ROOT` path in this skill and its playbooks as this skill's base directory two levels up (the `<skill>` block's `<path>`).

What should be true by tonight, this week, this month and this year. Goals are outcomes; the focus skill plans the tasks that reach them.

## Help

`/goals help` (or "what can goals do?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Start

1. Match the ask to a playbook below, open it, and copy its steps into your todo list. A step you skip stays in the list as `skip: <reason>`.
2. A bare `/goals` runs whatever is due: `bun "${CLAUDE_PLUGIN_ROOT}/skills/sync/scripts/cadence.ts"` lists the due cadences, and the first `goals …` entry in the order year, month, week is the command to run (`goals week interview` for the week). Nothing due means day.

## Playbooks

| Ask | Playbook |
|---|---|
| "set today's goals", "what should today achieve", `/goals day` | [day](references/playbooks/day.md) |
| "plan the week", "score the week", `/goals week` | [week](references/playbooks/week.md) |
| "set my weekly goals", "interview me for the week", sync's weekly nudge, `/goals week interview` | [week](references/playbooks/week.md), its interview |
| "monthly goals", "this month's themes", `/goals month` | [month](references/playbooks/month.md) |
| "set this year's goals", "yearly goals", `/goals year` | [year](references/playbooks/year.md) |

A roadmap page (a plan to look at) is the roadmap skill; goals are the TASKS.md blocks the roadmap feeds.

## Every time

- **The goal blocks, and the week's task plan.** Write inside `<!-- GOALS:START -->…<!-- GOALS:END -->` in `<HOME>/projects/TASKS.md`, one section per horizon (`## Daily Goals`, `## Weekly Goals`, `## Monthly Goals`, `## Yearly Goals`), and replace only the section the playbook owns. Everything outside the markers is rebuilt from tasks. Only the week playbook moves tasks, and only the goals the operator confirmed.
- **Confirmed before written.** Every goal traces to an answer the operator gave; a skipped or aborted interview writes nothing.
- **Stamp after writing.** Week, month and year stamp their cadence (`goals-week`, `goals-month`, `goals-year`) with `watermark.ts` only once the block is written, so sync stops nudging.

## Reply

The goals as written, then `📄 Saved to <path>` when the playbook saved a snapshot.
