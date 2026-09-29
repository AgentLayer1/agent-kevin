---
name: focus
description: >
  The operator's day in one place: what today is for, what slipped, the week and month, the roadmap
  in flight, who is waiting on them, and where every session left off. Home focus is the dashboard's
  Today tab; a project gets its own focus page. Plans tasks into today, the week or the month, writes
  the standup, sets and scores the week, and runs the session radar, triage and checkpoints.
  Triggers on "what should I work on", "plan my day", "I'm overwhelmed", "take this on", "add this to
  my list", "what do I owe people", "plan the week", "standup is coming up", "what did I do
  yesterday", "where am I", "what was I working on", "which session needs me", "checkpoint this
  session", a pasted link as something to do, or /focus.
allowed-tools:
  - AskUserQuestion
  - Bash
  - Glob
  - Read
  - Edit
  - mcp__plugin_agent-kevin_kevin__focus_write
  - mcp__plugin_agent-kevin_kevin__task_query
  - mcp__plugin_agent-kevin_kevin__task_create
  - mcp__plugin_agent-kevin_kevin__task_update
  - mcp__plugin_agent-kevin_kevin__task_get
  - mcp__plugin_agent-kevin_kevin__task_scan
  - mcp__plugin_agent-kevin_kevin__task_thread
  - mcp__plugin_agent-kevin_kevin__github_pr_list
  - mcp__plugin_agent-kevin_kevin__github_pr_view
  - mcp__plugin_agent-kevin_kevin__github_issue_view
  - mcp__plugin_agent-kevin_kevin__report_write
---

# Focus

The operator's day: what it's for, what slipped, what the week and month are for, what the roadmap has in flight, who is waiting on them, and where each session stands. The views are derived. Tasks are the source of truth, and the sessions on disk are what the radar reads.

## Help

`/focus help` (or "what can focus do?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Start

1. Match the ask to a playbook below, open it, and copy its steps into your todo list. A step you skip stays in the list as `skip: <reason>`. A bare `/focus` is refresh.
2. A word after the playbook that names a folder under `<HOME>/projects/` is the project (`/focus plan acme`): pass it as `project` on every `focus_write`.
3. Read the operator's identity once: `<HOME>/USER.md` for `**Name:**` and `**GitHub login:**`. If the login is missing, ask once and suggest adding it to USER.md.

## Playbooks

| Ask | Playbook |
|---|---|
| `/focus`, "refresh focus", "what's waiting on me", "what do I owe people" | [refresh](references/playbooks/refresh.md) |
| "take this on", "add this to my list", a pasted line, list, or link | [add](references/playbooks/add.md) |
| "plan my day", "what should I work on", "I'm overwhelmed", `/focus plan` | [plan](references/playbooks/plan.md) |
| "plan the week", "score the week", Monday and Friday standups, `/focus week` | [week](references/playbooks/week.md) |
| "standup is coming up", "what did I do yesterday", "I need my update", `/focus standup 48` | [standup](references/playbooks/standup.md) |
| "where am I", "what was I working on", "which sessions are open", `/focus where-am-i 48` | [where-am-i](references/playbooks/where-am-i.md) |
| "which session needs me", "what should I tend to", `/focus triage [scope]` | [triage](references/playbooks/triage.md) |
| "checkpoint this session", "save where we are", "write a handoff", `/focus checkpoint` | [checkpoint](references/playbooks/checkpoint.md) |
| First refresh with Slack connected: pull the priorities already posted there | [backfill](references/playbooks/backfill.md) |

When the operator names *what* a past session worked on (a branch, a PR, a bug) rather than when, that's the find-session skill, not where-am-i.

## The day's data

**Horizons.** A task's `horizon` says when it's planned, stored as the period itself:

| `horizon` | Lane |
|---|---|
| `2026-09-28` (a day) | Today on that day; Carried over once it has passed |
| `2026-W40` (an ISO week) | This week; Carried over after it |
| `2026-10` (a month) | This month; Carried over after it |
| `later` | Later |
| empty | Not planned |

Pass the shorthands `today`, `week`, `next-week`, `month` or `later` to `task_create` / `task_update`; the tool stores the period. Every task mutation re-renders the dashboard and each project focus page, so there is no save step. Week and month progress count every task planned inside the period, including ones since pulled into today and ones sync has archived.

**Where it shows.**

| Scope | Where | Holds |
|---|---|---|
| home (no project) | the dashboard's Today → Focus tab, `dashboard.html#today/focus` | every project, plus the Weekly and Monthly Goals |
| `<project>` | `<HOME>/projects/<project>/focus.html`, linked from its project card | that project's tasks only |

Both carry what they show as JSON in a `focus-data` block, and `focus_write` returns the same data (lanes, `planned`, `dueUnplanned`, `roadmap`, `snapshot`) with the `path`. "Mine" means a task whose assignee is empty, `user`, the agent's name, or the operator's first name or GitHub login; teammates' tasks stay off.

**Roadmaps.** The home view reads `<HOME>/roadmap.html`; a project view reads its own `projects/<slug>/roadmap.html` plus the root roadmap's milestones that name one of its task ids. Slipped milestones (their period ended with items open) and in-flight ones (an item in progress, or a period covering today) show with their linked tasks, and a milestone no open task names is a gap. A roadmap still on a script literal, one with no dates, or one that names no task ids gets a one-line notice instead.

**Sources.** GitHub is the queue's base. **Slack is optional:** it counts as connected when the session has Slack tools that identify the operator, search messages and read a thread, from any Slack MCP server the operator has added, and the identify call answers. In the playbooks, `slack_whoami`, `slack_search` and `slack_thread` stand for those three tools. Every Slack step runs only then: with no Slack tools, skip it silently; with tools that error, say so on the page (refresh, step 5).

**Sessions.** `bun "${CLAUDE_SKILL_DIR}/scripts/list_sessions.ts" --hours <N>` lists the Claude Code sessions in scope as JSON, newest first. The where-am-i, triage and standup playbooks describe its fields and scope.

## Every time

- **Never create or move a task the operator didn't place.** Every intake and every plan ends in a confirmed answer.
- **The queue is a snapshot.** Pages print when it was pulled, so never describe an old queue as current.
- **Outward actions stay outward.** Focus reads GitHub, and Slack when connected. It never comments, reviews, reacts, replies, or sends input to another session. Acting is the operator's next step.
- **Nothing claimed that didn't happen.** A standup never upgrades built to shipped; a radar summary never guesses what a session did (read the transcript tail instead).
- **Reports keep their names.** The standup saves as `slug: standup` in `briefings`, the radar as `slug: where-am-i` in `radar`, both with `skill: focus`, so the next run's gap check and the dashboard keep finding them.

## Reply

Each playbook names its reply: a focus card, a one-line confirmation, the standup card and its backup, the radar digest, a triage table, or a checkpoint. End with the `file://` path when a playbook saved or rendered something.
