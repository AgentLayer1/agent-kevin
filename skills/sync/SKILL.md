---
name: sync
description: End-to-end refresh — fast-forward the default branches of any configured code repos so Kevin grounds against current code, compile pending raw inputs, lint+fix the wiki, run a flywheel pass across active projects, surface what needs attention (including a pending plugin upgrade and any planning/review skill that's come due, with the slash command to run it), optionally chain into a morning or evening briefing, snapshot recent Claude Code sessions (where-am-i radar), then refresh both dashboards (TASKS.md + dashboard.html) last so they capture the briefing's news and the run's final state, and close with a short interview offering concrete next steps (only when something's actually surfaced) that you can act on now or queue as a task. Run anytime you want to bring Kevin's state fully current and get one consolidated update. Heavier than quick-pulse, lighter than running each skill by hand.
allowed-tools: mcp__plugin_agent-kevin_kevin__github_fast_forward, mcp__plugin_agent-kevin_kevin__compile_status, mcp__plugin_agent-kevin_kevin__compile_next, mcp__plugin_agent-kevin_kevin__compile_write, mcp__plugin_agent-kevin_kevin__knowledge_lint, mcp__plugin_agent-kevin_kevin__memory_prune, mcp__plugin_agent-kevin_kevin__links_rewrite, mcp__plugin_agent-kevin_kevin__dashboard, mcp__plugin_agent-kevin_kevin__report_write, mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_get, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__task_update, mcp__plugin_agent-kevin_kevin__task_thread, mcp__plugin_agent-kevin_kevin__task_close, mcp__plugin_agent-kevin_kevin__task_create, mcp__plugin_agent-kevin_kevin__web_search, Skill(agent-kevin:where-am-i), AskUserQuestion, Read, Write, Edit, Glob, Grep, Bash
---

# Sync

One pass through every maintenance op, in dependency order, ending in a single status line the user can scan in a second. Use this when you've been away for a while, when you want to start a session fresh, or when something feels stale and you don't want to think about which skill to run.

## Arguments

Optional first arg selects a briefing to chain after sync completes:

- `morning` — run the [morning-briefing](../morning-briefing/SKILL.md) protocol at step 8.
- `evening` — run the [evening-briefing](../evening-briefing/SKILL.md) protocol at step 8.
- _(none)_ — pick automatically from the local clock: **morning** from 3am up to 3pm, **evening** from 3pm up to 3am. (`date +%H` if today's time isn't already in context.) State which briefing was auto-selected in the output header.

The briefing reads the post-sync state, so it's strictly better than running the briefing standalone against stale data. Output gets a second block appended (see Output).

## Why this shape

Most maintenance ops have a natural order: compile feeds lint feeds the wiki state that briefings read. Running them piecemeal works but leaves you reconciling: did I compile before I lint? Did the dashboard update? `sync` runs the full chain and tells you the outcome — pass, partial, or fail — with the report paths anchored.

## Protocol

### 0. Refresh the code checkouts

Fast-forward the default branches of every repo Kevin grounds against, so the rest of the run — and the operator's next question about how something works — reads current code instead of whatever was on disk the last time someone thought to pull. This is the whole reason a non-technical operator never has to learn git: sync is the one command, and code freshness rides along with it. Engineers get it too, so `main` isn't three weeks stale in a checkout they only use for reference.

```
mcp__plugin_agent-kevin_kevin__github_fast_forward
```

No arguments: repos default to `KEVIN_CODE_PATH` plus `KEVIN_GIT_REPOS`. Both are optional — many operators run Kevin with no codebase at all, and the tool then reports an empty list, which reads as `🖥 Code — none configured` and is skipped silently. It returns per-repo and per-branch status; read them into the `🖥 Code` line.

**Why an MCP tool and not Bash here.** The Claude Code seatbelt gives non-proxied clients no DNS at all, so a `git fetch` over an SSH remote dies at hostname resolution — under a sandboxed session the Bash version of this step was a guaranteed no-op for any repo with a `git@github.com:` remote, which is most of them. The MCP server runs outside that sandbox, the same reason the rest of the `github_*` family lives there. It authenticates with the fine-grained read-only PAT (`GITHUB_TOKEN`) over HTTPS rather than the operator's SSH key: a scoped, rotatable, fetch-only credential instead of one that can also push and force-push everywhere. The checkout's own remote is left exactly as it is, so the operator's pushes keep using their key.

Branches are picked by **slot** — the first local match of `main` / `master`, and the first of `develop` / `dev` — so a vestigial `master` sitting beside a live `main` is never touched.

Why each guard is there — this step touches the operator's working repos, so it stays strictly forward-only. **This must stay safe for an engineer running many simultaneous branches and worktrees**, so the guarantees below were verified empirically against git 2.50, not assumed, and are pinned by the guard-matrix tests in `mcp-server/src/tools/github.test.ts`:

- **Exactly one authenticated network call per repo**, and it can only ever use the scoped PAT — the operator's keychain credential is never consulted, and a rejected token fails in about a second rather than hanging on a prompt. Every branch update after that fetch is local and needs no credential at all. (Mechanics live in the `CREDENTIAL_ARGS` docstring; they're maintainer detail, not something to restate in the report.)
- **Nothing is ever checked out, stashed, or committed.** The step runs exactly three verb families — `fetch`, `merge --ff-only`, and read-only queries (`rev-parse`, `show-ref`, `status`, `rev-list`). There is no `checkout`, `stash`, `reset`, `rebase`, `clean`, or `commit` anywhere in it, so the operator's current branch and working tree cannot be switched or swept out from under them.
- **A branch checked out in a linked worktree is refused by git itself.** `fetch . refs/remotes/origin/<br>:refs/heads/<br>` fails with `refusing to fetch into branch '<br>' checked out at '<path>'` (exit 128) — verified with a branch live in a sibling worktree holding uncommitted work: the ref didn't move, the worktree's HEAD didn't move, and the uncommitted file survived intact. The refusal lives in git's ref-update path, so it holds for a local fetch exactly as it does for a network one. Report it as `CLAIMED_BY_WORKTREE` — it means "someone's working on it," not "it's broken," so it must not be conflated with a real divergence.
- **Only branches that already exist locally.** `show-ref` gates every update on both `refs/heads/<br>` and `refs/remotes/origin/<br>`, so sync never conjures a `develop` an operator doesn't track. A fresh clone has just `main`, which is exactly what a non-technical operator needs.
- **Fast-forward or nothing.** The local `fetch` rejects a non-fast-forward ref update (exit 1, verified against a genuinely diverged branch), and the checked-out branch uses `merge --ff-only`. Local commits are never rewritten or discarded.
- **A dirty tree is never touched.** If the checked-out default branch has uncommitted work, report `SKIPPED_DIRTY` and move on. `status --porcelain` counts untracked files as dirty, which is deliberately conservative. Other branches still fast-forward, because a ref update on a branch that isn't checked out anywhere cannot alter any working tree.
- **Mid-rebase, mid-merge and detached HEAD are safe.** During a rebase git still reports the branch as checked out and refuses the ref update (verified — the in-progress rebase survived untouched). In a plain detached HEAD (bisect, `checkout <sha>`) the ref update *does* succeed, which is harmless: HEAD is a raw commit, so moving a branch pointer changes no file, no index, and no HEAD.
- **`--prune` only removes remote-tracking refs.** Local branches whose upstream disappeared are left alone (verified) — pruning `origin/feature` never deletes `feature`.
- **A failed fetch is not a failed sync.** No pack, no grant, no network — report it and continue. Code freshness is a convenience here, not a precondition for the knowledge chain.

Report the outcome in the `🖥 Code` line of the output block. `UPDATED` collapses to a count (`main +12`); a run that's entirely `CURRENT` collapses to a single "all current" line. `NOT_FAST_FORWARD` and `SKIPPED_DIRTY` are worth surfacing (that branch is now knowingly behind); `CLAIMED_BY_WORKTREE` is normal on a multi-worktree machine and should read as informational, not as a problem. Never "fix" a diverged, dirty, or worktree-held branch — surface it and let the operator decide.

`NOT_CONFIGURED` means the GitHub pack isn't set up in this home (no `GITHUB_TOKEN`): the tool reports it instead of failing, nothing was touched, and the right line is one neutral clause — `🖥 Code — skipped (GitHub pack not configured)` — plus `/agent-kevin:configure-skills` if the operator wants it on. Never dress this up as a problem; the rest of the chain is unaffected.

`FETCH_FAILED` carries a `reason`, and the three cases need different words. `NO_ACCESS` means the token authenticated but isn't authorized for that repo — it needs `Contents: Read`, and for an org repo an admin has to approve it; say that plainly instead of implying the repo is broken. `AUTH` is narrower: GitHub rejected the credential itself (expired, revoked, malformed), so the fix is re-minting, not re-scoping. `NETWORK` is just no egress. `NO_ACCESS` covers two observed shapes — `403` for a PAT the org hasn't approved, `404 Repository not found` for a repo the token can't see, since GitHub hides private-repo existence — and neither says which, so don't guess.

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

Run the [flywheel](../flywheel/SKILL.md) protocol — cross-project work sweep. Touch each active project at least briefly, advance/update/close tasks, capture decisions. Placement is deliberate: after the wiki is clean (steps 1-4) so the flywheel reads a current memory index, but **before** scan + dashboard (steps 6 and 10) so those reflect the post-flywheel task state.

Quick form for one-shot execution:
1. Read `<HOME>/knowledge/memory/index.md` `## Active Threads` for current portfolio state.
2. For each active project, `mcp__plugin_agent-kevin_kevin__task_query` with `{ project, status: "active" }` and `{ project, status: "open" }`.
3. For each task: **advance** (concrete work), **update** (`task_thread` with new info, `task_update` for status/priority changes), **close** (`task_close`), or **defer** (set blocked + reason).
4. **Archive sweep — unconditional.** Move every `status: done` / `status: cancelled` task file from `projects/<slug>/tasks/` into `projects/<slug>/tasks/archive/`. This is a deterministic janitor that runs every sync, independent of whether step 3 made any mutations. Discover candidates with `grep -l '^status: \(done\|cancelled\)' projects/*/tasks/*.md`; for each match, `mkdir -p` the project's archive dir and `mv` the file in. Don't touch files already under `archive/`.
5. If cross-cutting patterns emerge across ≥2 projects, draft a `<HOME>/knowledge/concepts/<slug>.md` and add a bullet to `knowledge/index.md` `## Concepts`.
6. Log architectural decisions to `<HOME>/knowledge/memory/index.md` `## Recent Decisions`.
7. **Persist flywheel snapshot.** Call `mcp__plugin_agent-kevin_kevin__report_write` with `category: 'briefings'`, `slug: 'flywheel'`, `skill: 'flywheel'`, a one-line title, a body covering projects touched + tasks moved + concepts drafted, and `status: 'findings'` if anything moved (closes, updates, threads, concepts, decisions) or `status: 'clean'` if only the archive sweep ran. The morning brief reads these to pick up the trail across sessions.

Bound the breadth: touch every active project, don't sink the whole session into one. The archive sweep (step 4) is the one mechanical action that always runs — closing tasks throughout the week without archiving lets `Recently Closed` accumulate and clutters the active dirs. Steps 4 and 7 are unconditional; everything else fires only when there's real work to do. Skip the in-skill wrap summary — that lands in step 7 below as part of the sync output. Flywheel's orient sub-steps (dashboard refresh, TASKS.md read, task_scan) are intentionally fanned out across sync's steps 6-10 (scan at 6, the dust-settled read at 7, the dashboard render last at 10) so they reflect post-flywheel — and post-briefing — state, not pre-flywheel.

### 6. Surface what needs attention

```
mcp__plugin_agent-kevin_kevin__task_scan
```

Returns `{ unblocked, autoBlocked, autoClosed, overdue, stale, priorityBumps, pendingIds }`. **`task_scan` is read-only — it computes these buckets but persists nothing.** Frontmatter `status` stays the source of truth (both TASKS.md and the dashboard count blocked/active from frontmatter, never from this scan). Treat every bucket as a human-judgment queue: when a computed `unblocked` / `autoBlocked` / `autoClosed` / `manualClosed` is genuinely right, apply it explicitly with `task_update` / `task_close`; surface `overdue` / `stale` / `priorityBumps` in the output. Note `autoBlocked` over-reports while archived done-deps aren't loaded into the dependency map — verify the dep is actually unresolved before acting.

**Also check for a pending plugin upgrade.** Drift between the installed plugin code and this home's migrated baseline is exactly a "needs attention" item: `/plugin update` refreshes code but never the home's scaffolded files (`CLAUDE.md`, `SOUL.md`, settings, rules), so a stale baseline means migrations are waiting. This is a read-only comparison only — **sync never runs `/upgrade`.** `/upgrade` backs up and mutates HOME files; that's a deliberate, operator-gated beat (and if it pulled new deps/MCP code it needs a Claude Code restart first). Sync's job is to raise the flag, same as the dashboard staleness warning.

```bash
HOME_DIR="${KEVIN_HOME:-$PWD}"
[ -d "$HOME_DIR/.kevin" ] || echo "NOT_AN_AGENT_HOME: $HOME_DIR"
# NOT_AN_AGENT_HOME → STOP the whole sync: no .kevin/ data dir means $HOME_DIR
# isn't this agent's scaffolded home, so every downstream read/write would hit
# the wrong tree. Tell the operator to set KEVIN_HOME or relaunch from the
# agent home.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
INSTALLED=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_ROOT/.claude-plugin/plugin.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
if [ -f "$HOME_DIR/.kevin/version.json" ]; then
  BASELINE=$(grep -o '"templateVersion"[[:space:]]*:[[:space:]]*"[^"]*"' "$HOME_DIR/.kevin/version.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
else
  BASELINE=""
fi
if ls "$PLUGIN_ROOT/CHANGELOG.md" >/dev/null 2>&1; then
  echo "installed=$INSTALLED baseline=${BASELINE:-<none>}"
else
  echo "no-changelog"   # plugin predates release tracking — no nudge
fi
```

Interpret (mirrors the upgrade skill's guards, nudge-only — no semver math needed, a string mismatch is enough to flag):

- **`no-changelog`** → plugin predates release tracking; say nothing.
- **baseline `<none>`** (no `version.json`) → update tracking never enabled; surface `Run /upgrade to enable update tracking`.
- **`baseline == installed`** → current; say nothing.
- **`baseline != installed`** → surface `Plugin vINSTALLED installed · home migrated to vBASELINE — run /upgrade`.

**Also check planning + review cadence.** The calendar-cadence skills (weekly-goals, monthly-goals, yearly-goals, self-review) are interactive interviews marked `disable-model-invocation: true` — they only run when the operator types the slash command, never on their own and never via the Skill tool. Sync can't run them; its job is to **notice when one is due and surface the nudge**, same as it does for a pending plugin upgrade. This step is read-only detection:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/skills/sync/scripts/cadence.ts"
```

Returns a JSON array of `{ skill, label, lastRun }` for each due item — empty `[]` means nothing's due (the common case; emit no Cadence block). Due rules baked into the script:

- **weekly-goals** — a new ISO week has begun since `lastRun` (or never run).
- **monthly-goals** — a new calendar month has begun since `lastRun`.
- **yearly-goals** — a new calendar quarter has begun since `lastRun`.
- **self-review** — `raw/user/feedback.md` has new entries since self-review's `lastRun` **and** that run is >14 days old. Count-driven, not pure calendar: stays silent when there's nothing accumulated to process.

Watermarks live in `.kevin/cadence.json` (the goals trio, keyed `skill → last-run date`, stamped by each goals skill on completion) and `.kevin/review.json` (`lastRun`, owned by self-review). The check creates nothing; a missing watermark just reads as "due". Surface due items in the `📅 Cadence` output block — a nudge with the slash command, nothing more.

### 7. Read the dust-settled state

After all mutations above, both `projects/TASKS.md` and the lint report at `.kevin/lint.md` are current — `TASKS.md` auto-regenerates on every task mutation (flywheel's closes/updates already rewrote it), and `task_scan` is read-only, so post-scan state equals post-flywheel state. Read them once each — these are your sources for the summary, not the per-tool return values:

```
Read <HOME>/projects/TASKS.md
Read <HOME>/.kevin/lint.md
Read <HOME>/knowledge/memory/index.md   # for narrative context
```

### 8. Briefing

Resolve which briefing to run: the explicit `morning`/`evening` arg wins; with no arg use the auto-selection from `## Arguments` (morning 3am–3pm, evening 3pm–3am). Then inline the matching protocol:

- `morning` → run [morning-briefing](../morning-briefing/SKILL.md) **in full** — render every section of its compose template (🌅 header · 🎯 Today · 📦 Drafted · 📈 Goals · 🏗️ Projects · 🕸️ Stale · 🌐 Signals · 📰 News · 👉 Today · 🍌), 400–600 words. **Step-7 reuse is narrow:** only the task/thread/scan + memory-index context is already in hand — don't re-query *those*. You still owe the briefing's other inputs: Glob + read today's raw sessions, the project-delta `find` + `git log`, the last-7-days briefings novelty check, and **2–4 focused `mcp__plugin_agent-kevin_kevin__web_search` clusters** (the plugin's Perplexity-backed tool, **not** Claude's built-in `WebSearch`) **— including a geopolitics / Muslim-world news cluster, not just the work-signal one**. Then **call `report_write` per the briefing skill's `## Persist` section** — compose-without-persist is a bug (not done until `reports/index.md` shows today's entry). Do **not** collapse the eight sections into a prose summary; match the depth of a standalone briefing.
- `evening` → run [evening-briefing](../evening-briefing/SKILL.md) **in full** — its complete section template, not a summary. Narrow step-7 reuse (task/memory context already loaded); still pull today's git log + closed-today tasks + raw sessions. Evening intentionally skips 🌐 Signals / 📰 News (scoped to closing the day). Then **call `report_write` per the briefing skill's `## Persist` section** — not done until persisted.

To run a sync with no briefing at all, say so explicitly (e.g. "sync only").

### 9. Session radar

Invoke the [where-am-i](../where-am-i/SKILL.md) skill (via the Skill tool, default 24h
window) — a snapshot of the Claude Code sessions scoped to the HOME plus the code tree
(where-am-i's default multi-root scope), so the sync run
leaves behind a dated record of which threads were live and where each stood. It owns
the radar end to end: scans the sessions, writes the per-session summaries, renders the
digest, and persists the report (`category: 'radar'`). Skip only if it reports zero
sessions. Don't reimplement its steps inline — `where-am-i` is the single source of truth.

Independent of the wiki state, so order doesn't matter for correctness — placed here so
the radar report lands in `reports/index.md` before step 10's dashboard render picks it
up.

### 10. Regenerate the dashboards (last)

This is the final step — it runs **after** the briefing, on purpose. `dashboard.html`'s News section is harvested from `reports/briefings/*.md`, and the Reports tab reads `reports/index.md` — both of which step 8 just wrote. Rendering here (rather than before the briefing) is what lets the dashboard show the current run's news and report entry instead of the previous run's. By now every upstream producer has run: compile, lint, flywheel mutations, scan, the briefing, and the session radar.

One call rebuilds both `<HOME>/dashboard.html` and `projects/TASKS.md` — call it once here, nowhere else in sync. It runs even for "sync only" (it just won't have new briefing news to pick up):

```
mcp__plugin_agent-kevin_kevin__dashboard
```

Returns `{ path, bytes, tasks: { active, blocked, overdue, stale, closedRecent } }`. One call, no judgment needed.

### 11. Closing interview — what's next (only when something's actionable)

After the output block (see below), turn the surfaced backlog into a decision. **Gate first:** skip the interview entirely on a clean bill — no overdue/stale item flagged for action, no priority bump, no cadence due, no pending upgrade, and an empty "Suggested next moves" list. The interview exists to act on what sync surfaced; with nothing surfaced, end on the output block (the `✅ Sync complete` one-liner) and stop.

When there *is* something to act on, end with a single `AskUserQuestion` call carrying two questions:

1. **"What do you want to tackle next?"** — options are the concrete candidates sync already surfaced in steps 6–7: the 2–3 "Suggested next moves", plus any overdue/stale item flagged for action, the due cadence skill (`/weekly-goals`, `/monthly-goals`, `/yearly-goals`, `/self-review`), or the pending `/upgrade`. Each label is the action itself ("Nudge Shiny on al-005", "Run /upgrade"); the description says why it's surfacing now. Pull these straight from state you already read — don't invent options the sync didn't produce. Cap at four; lead with the highest-leverage one.

   **Freshness gate — verify every candidate against current ground truth before offering it (do NOT skip).** The failure mode here is offering something the operator *already did*, often in the very sessions this sync just compiled. The Pending list in `memory/index.md`, the cadence watermarks, and even today's briefing are lagging views — a task can be closed, a bug already fixed, or a chore already handled between when that state was written and now. So for each candidate, confirm it's still open against the freshest source before it earns a slot:
   - **Task-backed candidate** → re-read the task's frontmatter `status` (a `done`/`cancelled`/`blocked`-on-someone-else task is not a "tackle next"). Prefer items whose status/thread you touched *this run* (flywheel step 5) over anything read only from the stale Pending list.
   - **"Did X get done already?" candidate** (a surfaced bug, a noisy log, a cleanup) → this is exactly the "derived state ≠ source of truth" trap. Check the actual artifact — grep the code, read the file, pull the live log/metric — or scan today's compiled sessions for the fix. If it was handled (even minutes before this sync), drop it. When you can't cheaply verify, phrase it as a *verification* step ("confirm X is still an issue"), never as a bare "do X".
   - **Cadence/upgrade candidate** → only surface if the step-6 check *this run* said it's due (watermark null/stale) AND you didn't see it satisfied in today's sessions. A cadence the operator just ran or consciously skipped is not a fresh suggestion.
   - **Prefer today's deltas.** The best next-move candidates come from what *moved* this run — a task closed today that unblocks a dependent, a follow-up the just-compiled sessions explicitly named as "next", a flag raised in the briefing. Rank those above anything lifted from long-standing Pending bullets. If freshness-checking empties the list, offer fewer options (or none — re-gate: a fully-verified-empty list means skip the interview).
2. **"Act on it now, or queue it as a task?"** — options `Act now` / `Queue as a task`.

Then honor the second answer:

- **Act now** → do the chosen step this session. External/outbound actions (emails, messages, public posts, `git push`, anything that leaves the machine) still confirm first per the operating rules — an interview pick is not standing authorization for those.
- **Queue as a task** → if the choice maps to an existing task, `task_thread` a note and bump priority/status as fitting; otherwise `task_create` one. Confirm the id/title back in a single line, then stop.

**Exception for cadence/upgrade picks:** the goals/review skills are `disable-model-invocation` and `/upgrade` is operator-gated, so sync can't run them either way. For those, both answers collapse to the same thing — surface the exact slash command for the operator to type. Don't attempt to invoke them via the Skill tool.

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

🖥 Code (omit entirely when no repos are configured)
  - <"N repos, all default branches current" | one line per repo/branch that was behind, updated, dirty, or held by a worktree>

🖥 Dashboard — <HOME>/dashboard.html refreshed

📅 Cadence (only when something is due — omit entirely when the cadence check returns [])
  - <label> due (last set <lastRun | never>) → /<skill>

⬆️ Upgrade (only when drift detected — omit entirely when up to date)
  - <Plugin vINSTALLED installed · home migrated to vBASELINE — run /upgrade>
  - <or: Run /upgrade to enable update tracking>

⚠️ Lint errors (if any)
  - <one line per error, with file path>

💡 Suggested next moves
  - <2-3 concrete tasks the user could pick up right now, based on what's actually open — each freshness-checked per step 11's gate; drop anything already handled (often in the sessions this sync just compiled), favour today's deltas over stale Pending bullets>
```

If everything is clean: a one-liner is the right output.

```
✅ Sync complete — wiki healthy, <N> active tasks, nothing flagged.
```

A pending upgrade or a due cadence item is "something flagged" — if either fired, don't use the clean one-liner; keep the `⬆️ Upgrade` and `📅 Cadence` lines so the nudge isn't swallowed:

```
✅ Sync complete — wiki healthy, <N> active tasks. ⬆️ Plugin vINSTALLED — run /upgrade.
```

If a briefing arg was supplied, append the briefing block below the sync block (or below the one-liner). Two blocks, one message — sync on top, briefing underneath. Don't merge them; the shapes are distinct on purpose.

The output block is the last *text* of the run. The step-11 interview, when it fires, comes after it as the closing `AskUserQuestion` — emit the block, then ask. On a clean bill there's no interview; the block (or one-liner) is the end.

## Boundaries

- **Don't synthesize the compile prompt's content here.** Step 1 follows the compile loop verbatim — the `prompt` field tells you what to do for each item; don't improvise.
- **Don't auto-close tasks based on lint output.** Lint reports orphan articles, not task health.
- **Don't open new tasks from this skill.** Surface "needs attention" items in the summary; let the user choose what to file.
- **One pass only.** If a step fails 3 times, surface the error and stop. Don't loop indefinitely.
- **Step 0 is fast-forward only.** Never rebase, reset, force, stash, commit, or check out a different branch to make a pull succeed. A diverged, dirty, or worktree-held branch gets reported, not resolved — that's the operator's call. If a future edit to this step needs `checkout` or `stash` to work, the edit is wrong.

## Anti-patterns

- ❌ Running this every session reflexively. Use `quick-pulse` if you just want a status check.
- ❌ Hiding lint errors because they're "not blocking." If lint flagged 3 errors, list all 3.
- ❌ Skipping the dust-settled re-read. Per-tool return values are useful for tracing, but the rendered files are the source of truth for the summary.
- ❌ Writing prose paragraphs in the output. The block format above is the contract.
