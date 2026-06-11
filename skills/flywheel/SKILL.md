---
name: flywheel
description: Cross-project work session. Triage active tasks, advance every project meaningfully, close what's done, log what mattered. Invoke when you have time to work across the whole portfolio rather than one focus area.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_get, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__task_dashboard, mcp__plugin_agent-kevin_kevin__task_update, mcp__plugin_agent-kevin_kevin__task_thread, mcp__plugin_agent-kevin_kevin__task_close, mcp__plugin_agent-kevin_kevin__task_create, Read, Write, Edit, Glob, Grep, Bash
---

# Flywheel Session

The engine that moves your projects forward — every active project gets real attention, and the session output compounds across future work.

## Core principle

Don't just pick the most urgent thing and ride it for the whole session. Touch each active project at least briefly so context stays fresh across the whole portfolio. The flywheel is about **breadth → depth**, not depth alone.

## Protocol

### 1. Orient (3 minutes)

Refresh the dashboard, then read it as your single source of truth for what's active across the portfolio:
```
mcp__plugin_agent-kevin_kevin__task_dashboard
Read <HOME>/projects/TASKS.md
```

`TASKS.md` is auto-rebuilt from task frontmatter on every mutation; refreshing first guarantees the view matches disk. The call also regenerates the Agent OS dashboard (`<HOME>/index.html`) — the two derived views always refresh together, so no separate `status_dashboard` call is needed anywhere in this skill. The rendered sections (Active grouped by project, Blocked, Overdue, Stale, Recently Closed) are your action queue — no need to chain per-project queries to get the same picture.

Then read `<HOME>/knowledge/memory/index.md` end to end for narrative context. The `## Active Threads` section explains the *why* behind the tasks. If it conflicts with `TASKS.md`, trust the dashboard — frontmatter is source of truth; memory index is a synthesis that the next compile will reconcile.

Run `mcp__plugin_agent-kevin_kevin__task_scan` if you want resolver insight (auto-unblock candidates, priority bumps from low-priority blockers under high-priority tasks).

### 2. Sweep active tasks per project

Walk the Active section of `TASKS.md` project by project. Only when you need full task detail (description, checklist, thread history) reach for:
```
mcp__plugin_agent-kevin_kevin__task_get with { id: "<id>" }
```

Decide for each:
- **Advance** — make concrete progress (write code, draft a doc, send a message, run a query).
- **Update** — log new info via `mcp__plugin_agent-kevin_kevin__task_thread`, change status/priority/due if reality shifted.
- **Close** — if done, `mcp__plugin_agent-kevin_kevin__task_close`. Don't leave finished work as "active".
- **Defer** — set status to `blocked` with a real blocker note, or change priority to P3 and move on.

### 3. Archive closed tasks

Sweep every `status: done` or `status: cancelled` task file still living in `<HOME>/projects/<slug>/tasks/` into the project's `tasks/archive/` subdir. This keeps the active dir scannable and matches what the dashboard already does (it skips `tasks/archive/`).

```
Bash: mkdir -p <HOME>/projects/<slug>/tasks/archive && mv <HOME>/projects/<slug>/tasks/<id>-*.md <HOME>/projects/<slug>/tasks/archive/
```

Find candidates with grep across `projects/*/tasks/*.md` for `^status: (done|cancelled)` in frontmatter. Don't touch files already under `archive/`. After moving, refresh `task_dashboard` so `TASKS.md` and the Agent OS dashboard re-render without the archived rows.

### 4. Identify cross-cutting opportunities

As you work, watch for patterns that span 2+ projects (e.g., the same library helps two projects, a decision in one affects another). When you find one, draft a `<HOME>/knowledge/concepts/<slug>.md` capturing it. Don't force this — only do it when the connection is real.

### 5. Capture decisions

If you made a decision worth remembering (architectural call, priority shift, dropped scope), add a one-liner to `<HOME>/knowledge/memory/index.md` → `## Recent Decisions` with today's date and a brief rationale.

### 6. Wrap

Briefly summarise to the user:
- Which projects you touched and what changed (1 line each)
- Tasks closed / created / status-changed (just IDs)
- Concepts drafted (if any)
- What you'd tackle next session

Keep the summary tight. The thread entries on each task carry the detail. Both dashboards (`TASKS.md` + `index.html`) already re-rendered themselves after every mutation in this session — no manual `task_dashboard` or `status_dashboard` call needed at wrap unless something seems off.

### 7. Persist

After the wrap, **persist a snapshot** via the
`mcp__plugin_agent-kevin_kevin__report_write` MCP tool — captures what moved
across projects in this session so the next morning brief can pick up the trail:

```
report_write({
  category: 'briefings',
  slug: 'flywheel',
  title: <e.g. 'Flywheel session — 4 projects touched, 6 tasks moved'>,
  skill: 'flywheel',
  body: <the wrap summary + per-project deltas + concepts drafted, no frontmatter>,
  status: <'findings' on a normal session, 'clean' if nothing moved>
});
```

Surface `📄 Saved to <relPath>` to the operator alongside the wrap.

## Anti-patterns

- ❌ Spending 90% of the session on one project. The whole point is breadth.
- ❌ Closing tasks without verifying they're actually done.
- ❌ Creating new concept articles for things that only apply to one project.
- ❌ Writing long status updates in the session output instead of in task threads.
- ❌ Mentioning a task by ID without confirming its status first — IDs go stale fast.
