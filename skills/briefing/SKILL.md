---
name: briefing
description: >
  The day's bookends and a quick check. The morning brief: today's priorities, what moved
  overnight, goals, per-project state, stale work, signal-topic and world news, and one first move.
  The evening wrap: what shipped, drafted and stalled today, the goals delta, and tomorrow's first
  move. The pulse: a 60-second scan for anything overdue, stale or blocked. Triggers on "brief me",
  "morning brief", "daily brief", "wrap up the day", "evening wrap", "what did I ship today", "how did
  today go", "quick pulse", "anything on fire", "status check", or /briefing.
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_get, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__focus_write, mcp__plugin_agent-kevin_kevin__web_search, mcp__plugin_agent-kevin_kevin__report_write, WebSearch, Read, Glob, Bash
---

# Briefing

> **Plugin root.** Claude Code fills in `CLAUDE_PLUGIN_ROOT`; Codex leaves it unset. Under Codex, read every `CLAUDE_PLUGIN_ROOT` path in this skill and its playbooks as this skill's base directory two levels up (the `<skill>` block's `<path>`).

Three reads of the same state at different depths: the morning brief orients, the evening wrap closes the day, and the pulse checks for fire.

## Help

`/briefing help` (or "what can briefing do?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Start

1. Match the ask to a playbook below and follow it. A bare `/briefing` picks the way sync does: morning when no morning brief ran today (`<HOME>/reports/briefings/<today>-*-morning.md`) and it's between 3am and 9pm (`date +%H`), evening otherwise.
2. Sync runs the morning or evening playbook as one of its own steps; follow it the same way.

## Playbooks

| Ask | Playbook |
|---|---|
| "brief me", "morning brief", "daily brief", `/briefing morning` | [morning](references/playbooks/morning.md) |
| "wrap up the day", "evening wrap", "what did I ship today", "how did today go", `/briefing evening` | [evening](references/playbooks/evening.md) |
| "quick pulse", "anything on fire", "status check", `/briefing pulse` | [pulse](references/playbooks/pulse.md) |

## Every time

- **Read-only on the board.** A briefing never creates, moves or closes a task, and never sets goals; it names the next move instead.
- **Reports keep their names.** Morning saves as `slug: 'morning'` and evening as `slug: 'evening'` in `briefings`, both with `skill: 'briefing'`: sync's catch-up check globs `*-morning.md`.

## Reply

Each playbook names its card. The morning and evening briefs end with `📄 Saved to <path>`.
