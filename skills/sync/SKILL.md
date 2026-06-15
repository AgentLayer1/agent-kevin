---
name: sync
description: End-to-end refresh — compile pending raw inputs, lint+fix the wiki, run a flywheel pass across active projects, surface what needs attention, optionally chain into a morning or evening briefing, then refresh both dashboards (TASKS.md + dashboard.html) last so they capture the briefing's news and the run's final state. Run anytime you want to bring Kevin's state fully current and get one consolidated update. Heavier than quick-pulse, lighter than running each skill by hand.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__compile_status, mcp__plugin_agent-kevin_kevin__compile_next, mcp__plugin_agent-kevin_kevin__compile_write, mcp__plugin_agent-kevin_kevin__knowledge_lint, mcp__plugin_agent-kevin_kevin__memory_prune, mcp__plugin_agent-kevin_kevin__links_rewrite, mcp__plugin_agent-kevin_kevin__dashboard, mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_get, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__task_update, mcp__plugin_agent-kevin_kevin__task_thread, mcp__plugin_agent-kevin_kevin__task_close, mcp__plugin_agent-kevin_kevin__task_create, mcp__plugin_agent-kevin_kevin__perplexity_search, Read, Write, Edit, Glob, Grep, Bash
---

# Sync

One pass through every maintenance op, in dependency order, ending in a single status line the user can scan in a second. Use this when you've been away for a while, when you want to start a session fresh, or when something feels stale and you don't want to think about which skill to run.

## Arguments

Optional first arg selects a briefing to chain after sync completes:

- `morning` — run the [morning-briefing](../morning-briefing/SKILL.md) protocol after step 7.
- `evening` — run the [evening-briefing](../evening-briefing/SKILL.md) protocol after step 7.
- _(none)_ — pick automatically from the local clock: **morning** from 3am up to 3pm, **evening** from 3pm up to 3am. (`date +%H` if today's time isn't already in context.) State which briefing was auto-selected in the output header.

The briefing reads the post-sync state, so it's strictly better than running the briefing standalone against stale data. Output gets a second block appended (see Output).

## Why this shape

Most maintenance ops have a natural order: compile feeds lint feeds the wiki state that briefings read. Running them piecemeal works but leaves you reconciling: did I compile before I lint? Did the dashboard update? `sync` runs the full chain and tells you the outcome — pass, partial, or fail — with the report paths anchored.

## Protocol

### 1. Compile pending raw inputs

Loop the standard compile protocol — exactly the steps in [knowledge-compile](../knowledge-compile/SKILL.md), inlined here for one-shot execution:

```
mcp__plugin_agent-kevin_kevin__compile_status     # see what's pending
```

If anything is pending, loop:
1. `mcp__plugin_agent-kevin_kevin__compile_next` — returns `{ itemId, kind, fileName, prompt, meta }` or `{ done: true }`.
2. If `done`, exit the loop.
3. Read the `prompt` field carefully; perform the synthesis using Read/Write/Edit per its instructions.
4. `mcp__plugin_agent-kevin_kevin__compile_write` with the `itemId`.
5. Goto 1.

If nothing is pending, skip to step 2.

Track: how many items processed, any errors.

### 2. Lint + auto-fix

```
mcp__plugin_agent-kevin_kevin__knowledge_lint with { fix: true }
```

Returns `{ status, message, errors, warnings, suggestions, fixed, reportPath }`. Auto-fix rewrites stale wikilinks and inserts missing backlinks. The remaining `errors` are real — they need human judgment.

### 3. Prune transient memory

```
mcp__plugin_agent-kevin_kevin__memory_prune
```

Deletes `memory/YYYY-MM-DD*.md` older than the retention window (14 days). Cheap, idempotent. Skip if no daily memory files exist.

### 4. Rewrite stale wikilinks (defensive)

```
mcp__plugin_agent-kevin_kevin__links_rewrite
```

Lint with `fix:true` already calls this internally — running it again is a no-op when the wiki is clean. Skip if step 2 reported zero auto-fixes.

### 5. Flywheel pass

Run the [flywheel](../flywheel/SKILL.md) protocol — cross-project work sweep. Touch each active project at least briefly, advance/update/close tasks, capture decisions. Placement is deliberate: after the wiki is clean (steps 1-4) so the flywheel reads a current memory index, but **before** scan + dashboard (steps 6 and 9) so those reflect the post-flywheel task state.

Quick form for one-shot execution:
1. Read `<HOME>/knowledge/memory/index.md` `## Active Threads` for current portfolio state.
2. For each active project, `mcp__plugin_agent-kevin_kevin__task_query` with `{ project, status: "active" }` and `{ project, status: "open" }`.
3. For each task: **advance** (concrete work), **update** (`task_thread` with new info, `task_update` for status/priority changes), **close** (`task_close`), or **defer** (set blocked + reason).
4. **Archive sweep — unconditional.** Move every `status: done` / `status: cancelled` task file from `projects/<slug>/tasks/` into `projects/<slug>/tasks/archive/`. This is a deterministic janitor that runs every sync, independent of whether step 3 made any mutations. Discover candidates with `grep -l '^status: \(done\|cancelled\)' projects/*/tasks/*.md`; for each match, `mkdir -p` the project's archive dir and `mv` the file in. Don't touch files already under `archive/`.
5. If cross-cutting patterns emerge across ≥2 projects, draft a `<HOME>/knowledge/concepts/<slug>.md` and add a bullet to `knowledge/index.md` `## Concepts`.
6. Log architectural decisions to `<HOME>/knowledge/memory/index.md` `## Recent Decisions`.
7. **Persist flywheel snapshot.** Call `mcp__plugin_agent-kevin_kevin__report_write` with `category: 'briefings'`, `slug: 'flywheel'`, `skill: 'flywheel'`, a one-line title, a body covering projects touched + tasks moved + concepts drafted, and `status: 'findings'` if anything moved (closes, updates, threads, concepts, decisions) or `status: 'clean'` if only the archive sweep ran. The morning brief reads these to pick up the trail across sessions.

Bound the breadth: touch every active project, don't sink the whole session into one. The archive sweep (step 4) is the one mechanical action that always runs — closing tasks throughout the week without archiving lets `Recently Closed` accumulate and clutters the active dirs. Steps 4 and 7 are unconditional; everything else fires only when there's real work to do. Skip the in-skill wrap summary — that lands in step 7 below as part of the sync output. Flywheel's orient sub-steps (dashboard refresh, TASKS.md read, task_scan) are intentionally fanned out across sync's steps 6-9 (scan at 6, the dust-settled read at 7, the dashboard render last at 9) so they reflect post-flywheel — and post-briefing — state, not pre-flywheel.

### 6. Surface what needs attention

```
mcp__plugin_agent-kevin_kevin__task_scan
```

Returns `{ unblocked, autoBlocked, autoClosed, overdue, stale, priorityBumps, pendingIds }`. **`task_scan` is read-only — it computes these buckets but persists nothing.** Frontmatter `status` stays the source of truth (both TASKS.md and the dashboard count blocked/active from frontmatter, never from this scan). Treat every bucket as a human-judgment queue: when a computed `unblocked` / `autoBlocked` / `autoClosed` / `manualClosed` is genuinely right, apply it explicitly with `task_update` / `task_close`; surface `overdue` / `stale` / `priorityBumps` in the output. Note `autoBlocked` over-reports while archived done-deps aren't loaded into the dependency map — verify the dep is actually unresolved before acting.

### 7. Read the dust-settled state

After all mutations above, both `projects/TASKS.md` and the lint report at `.kevin/lint.md` are current — `TASKS.md` auto-regenerates on every task mutation (flywheel's closes/updates already rewrote it), and `task_scan` is read-only, so post-scan state equals post-flywheel state. Read them once each — these are your sources for the summary, not the per-tool return values:

```
Read <HOME>/projects/TASKS.md
Read <HOME>/.kevin/lint.md
Read <HOME>/knowledge/memory/index.md   # for narrative context
```

### 8. Briefing

Resolve which briefing to run: the explicit `morning`/`evening` arg wins; with no arg use the auto-selection from `## Arguments` (morning 3am–3pm, evening 3pm–3am). Then inline the matching protocol:

- `morning` → run [morning-briefing](../morning-briefing/SKILL.md) **in full** — render every section of its compose template (🌅 header · 🎯 Today · 📦 Drafted · 📈 Goals · 🏗️ Projects · 🕸️ Stale · 🌐 Signals · 📰 News · 👉 Today · 🍌), 400–600 words. **Step-7 reuse is narrow:** only the task/thread/scan + memory-index context is already in hand — don't re-query *those*. You still owe the briefing's other inputs: Glob + read today's raw sessions, the project-delta `find` + `git log`, the last-7-days briefings novelty check, and **2–4 focused `perplexity_search` clusters — including a geopolitics / Muslim-world news cluster, not just the work-signal one**. Then **call `report_write` per the briefing skill's `## Persist` section** — compose-without-persist is a bug (not done until `reports/index.md` shows today's entry). Do **not** collapse the eight sections into a prose summary; match the depth of a standalone briefing.
- `evening` → run [evening-briefing](../evening-briefing/SKILL.md) **in full** — its complete section template, not a summary. Narrow step-7 reuse (task/memory context already loaded); still pull today's git log + closed-today tasks + raw sessions. Evening intentionally skips 🌐 Signals / 📰 News (scoped to closing the day). Then **call `report_write` per the briefing skill's `## Persist` section** — not done until persisted.

To run a sync with no briefing at all, say so explicitly (e.g. "sync only").

### 9. Regenerate the dashboards (last)

This is the final step — it runs **after** the briefing, on purpose. `dashboard.html`'s News section is harvested from `reports/briefings/*.md`, and the Reports tab reads `reports/index.md` — both of which step 8 just wrote. Rendering here (rather than before the briefing) is what lets the dashboard show the current run's news and report entry instead of the previous run's. By now every upstream producer has run: compile, lint, flywheel mutations, scan, and the briefing.

One call rebuilds both `<HOME>/dashboard.html` and `projects/TASKS.md` — call it once here, nowhere else in sync. It runs even for "sync only" (it just won't have new briefing news to pick up):

```
mcp__plugin_agent-kevin_kevin__dashboard
```

Returns `{ path, bytes, tasks: { active, blocked, overdue, stale, closedRecent } }`. One call, no judgment needed.

## Output

One block, tight. Skip empty sections — don't pad.

```
🔄 Sync complete — <today's date>

📚 Knowledge
  - Compile: <N items processed | already current>
  - Lint: <errors> errors, <warnings> warnings, <suggestions> suggestions (<fixed> auto-fixed)
  - Memory pruned: <N files | none to prune>

⚙️ Flywheel
  - Projects touched: <project1, project2, ...>
  - Tasks closed: <ids | none>
  - Tasks updated/threaded: <ids | none>
  - New concepts: <slugs | none>

📋 Tasks
  - Active <count> · Blocked <count> · Overdue <count> · Stale <count> · Recently closed <count>
  - 👉 Needs attention:
      - <overdue/stale items with suggested action — max 3>
      - <priority bumps if any>

🖥 Dashboard — <HOME>/dashboard.html refreshed

⚠️ Lint errors (if any)
  - <one line per error, with file path>

💡 Suggested next moves
  - <2-3 concrete tasks the user could pick up right now, based on what's actually open>
```

If everything is clean: a one-liner is the right output.

```
✅ Sync complete — wiki healthy, <N> active tasks, nothing flagged.
```

If a briefing arg was supplied, append the briefing block below the sync block (or below the one-liner). Two blocks, one message — sync on top, briefing underneath. Don't merge them; the shapes are distinct on purpose.

## Boundaries

- **Don't synthesize the compile prompt's content here.** Step 1 follows the compile loop verbatim — the `prompt` field tells you what to do for each item; don't improvise.
- **Don't auto-close tasks based on lint output.** Lint reports orphan articles, not task health.
- **Don't open new tasks from this skill.** Surface "needs attention" items in the summary; let the user choose what to file.
- **One pass only.** If a step fails 3 times, surface the error and stop. Don't loop indefinitely.

## Anti-patterns

- ❌ Running this every session reflexively. Use `quick-pulse` if you just want a status check.
- ❌ Hiding lint errors because they're "not blocking." If lint flagged 3 errors, list all 3.
- ❌ Skipping the dust-settled re-read. Per-tool return values are useful for tracing, but the rendered files are the source of truth for the summary.
- ❌ Writing prose paragraphs in the output. The block format above is the contract.
