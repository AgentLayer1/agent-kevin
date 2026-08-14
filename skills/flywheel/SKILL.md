---
name: flywheel
description: Cross-project work session. Read the north-star roadmap for the frame, triage active tasks against it, advance every project meaningfully, close what's done, keep the roadmaps honest, log what mattered. Invoke when you have time to work across the whole portfolio rather than one focus area.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_get, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__dashboard, mcp__plugin_agent-kevin_kevin__task_update, mcp__plugin_agent-kevin_kevin__task_thread, mcp__plugin_agent-kevin_kevin__task_close, mcp__plugin_agent-kevin_kevin__task_create, Read, Write, Edit, Glob, Grep, Bash
---

# Flywheel Session

The engine that moves your projects forward — every active project gets real attention, and the session output compounds across future work.

## Core principle

Don't just pick the most urgent thing and ride it for the whole session. Touch each active project at least briefly so context stays fresh across the whole portfolio. The flywheel is about **breadth → depth**, not depth alone.

## Protocol

### 1. Orient (3 minutes)

Refresh the dashboard, then read it as your single source of truth for what's active across the portfolio:
```
mcp__plugin_agent-kevin_kevin__dashboard
Read <HOME>/projects/TASKS.md
```

`TASKS.md` is auto-rebuilt from task frontmatter on every mutation; refreshing first guarantees the view matches disk. The `dashboard` tool regenerates both views (`TASKS.md` + the Agent OS `dashboard.html`) in one pass, so one call covers everything. The rendered sections (Active grouped by project, Blocked, Overdue, Stale, Recently Closed) are your action queue — no need to chain per-project queries to get the same picture.

Then read `<HOME>/knowledge/memory/index.md` end to end for narrative context. The `## Active Threads` section explains the *why* behind the tasks. If it conflicts with `TASKS.md`, trust the dashboard — frontmatter is source of truth; memory index is a synthesis that the next compile will reconcile.

Run `mcp__plugin_agent-kevin_kevin__task_scan` if you want resolver insight (auto-unblock candidates, priority bumps from low-priority blockers under high-priority tasks).

Finally, the north star: `<HOME>/roadmap.html` is the strategic frame the whole portfolio ladders up to. Only its `ROADMAP` data object matters, not the markup or the renderers below it:

```
Bash: grep -n "const ROADMAP" <HOME>/roadmap.html
Read <HOME>/roadmap.html with { offset: <that line> }   # to EOF — a truncated object is not a frame
```

Lanes, horizons, and milestone statuses tell you which work is *on the path* and which is a detour. Use it as the tie-breaker whenever two tasks look equally urgent: the one serving a lane with a near finish line wins. A project with no milestone on any lane is a signal too — either it's off the path (fine, say so) or the roadmap is stale. No `roadmap.html` at HOME root? Note it once in the wrap and offer `/agent-kevin:roadmap` — don't build one mid-flywheel.

### 2. Sweep active tasks per project

Walk the Active section of `TASKS.md` project by project. Only when you need full task detail (description, checklist, thread history) reach for:
```
mcp__plugin_agent-kevin_kevin__task_get with { id: "<id>" }
```

A project keeping its own roadmap has it at `projects/<slug>/roadmap.html` (same convention as the HOME-root north star, one level down). Read its `ROADMAP` object the same way before deciding what to advance — it's the project-level plan the task board implements, and it usually names the next milestone more clearly than any single task does.

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

Find candidates with grep across `projects/*/tasks/*.md` for `^status: (done|cancelled)` in frontmatter. Don't touch files already under `archive/`. After moving, run the `dashboard` tool so `TASKS.md` and the Agent OS dashboard re-render without the archived rows.

### 4. Reconcile the roadmaps you read

A roadmap is only worth reading if it tracks reality. When this session moved something a roadmap claims, flip that item's `status` (`done` / `progress` / `planned`) with a targeted `Edit` on the `ROADMAP` object — nothing else. `done` needs evidence from this session (a closed task, a merged commit, the operator's word); when in doubt, leave it.

Everything else is out of scope here: structural changes (a new lane or milestone, a moved horizon, re-cut periods) and drift an edit can't absorb (a lane gone quietly stale, a finish line that's no longer plausible) go in the wrap for the operator, with `/agent-kevin:roadmap` offered. Never regenerate the file.

### 5. Identify cross-cutting opportunities

As you work, watch for patterns that span 2+ projects (e.g., the same library helps two projects, a decision in one affects another). When you find one, draft a `<HOME>/knowledge/concepts/<slug>.md` capturing it. Don't force this — only do it when the connection is real.

### 6. Capture decisions

If you made a decision worth remembering (architectural call, priority shift, dropped scope), add a one-liner to `<HOME>/knowledge/memory/index.md` → `## Recent Decisions` with today's date and a brief rationale.

### 7. Wrap

Briefly summarise to the user:
- Which projects you touched and what changed (1 line each), and which north-star lane that served
- Tasks closed / created / status-changed (just IDs)
- Roadmap edits made (file + item), plus any drift you couldn't fix in place
- Concepts drafted (if any)
- What you'd tackle next session

Keep the summary tight. The thread entries on each task carry the detail. Both dashboards (`TASKS.md` + `dashboard.html`) already re-rendered themselves after every mutation in this session — no manual `dashboard` call needed at wrap unless something seems off.

### 8. Persist

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

Surface `📄 Saved to <path>` (the absolute `path` the tool returns, not `relPath` — so it's command-clickable in any terminal) to the operator alongside the wrap.

## Anti-patterns

- ❌ Spending 90% of the session on one project. The whole point is breadth.
- ❌ Closing tasks without verifying they're actually done.
- ❌ Creating new concept articles for things that only apply to one project.
- ❌ Writing long status updates in the session output instead of in task threads.
- ❌ Mentioning a task by ID without confirming its status first — IDs go stale fast.
- ❌ Working the whole session without opening the north star, then reporting motion that serves no lane.
- ❌ Regenerating a roadmap, or upgrading a milestone to ✅ on vibes. Status edits are surgical and evidence-backed.
