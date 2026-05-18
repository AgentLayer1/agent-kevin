---
name: archive-project
description: Retire a completed or cancelled project cleanly. Moves the project folder to the root-level archive/, strips references from active docs, heartbeat schedules, and task-management code, adds a final-thoughts banner to the project README, logs the archival in today's session file, and runs the knowledge compile to refresh the project index. Use when the user says "archive <project>", "retire <project>", or declares a project done/cancelled.
disable-model-invocation: true
---

# Archive Project

Retire a completed or cancelled project so it's preserved for history but no longer drains attention from active work.

## When to use
- User explicitly asks to archive, retire, or close a project
- A project's work is genuinely complete (final deliverable shipped) or permanently abandoned
- Never archive a project that is merely paused or blocked — use task-level `blocked_by` instead

## Inputs
- `<project>` — the folder name under `projects/` (e.g., `support-agent`, `blog-dev`)
- `<reason>` — one-line why (shipped / cancelled / rolled into X)

## Why this design
- `archive/` sits at the repo root (not under `PROJECTS_ROOT`) so the knowledge-pipeline's `syncProjectIndex()` doesn't mistake "archive" for a project. Every internal scanner (`syncProjectIndex`, `tasks/scan.ts`, `tasks/mutate.ts`, `lint.ts`) routes through `FOLDERS.PROJECTS` — moving a project out of that folder automatically removes it from all scanners with zero config changes.
- Historical session logs in `knowledge/raw/sessions/` and `knowledge/raw/archive/` are point-in-time records and stay untouched. Breaking links there is acceptable; they're compiled into transient memory and eventually pruned.
- Task files travel with the project into `archive/`. Their internal path references (e.g., `Projects/support-agent/src/...`) become historical — they describe what was true when the work was done.

## Protocol

Do these in order. Steps 1-3 are reversible; after step 4 (move), be deliberate.

> **Path note:** `projects/` paths shown below are conceptual — the actual folder location follows `PROJECTS_ROOT` from `app/.env` (default `<repo>/projects/`). For shell commands, resolve the absolute path once at the top of your session:
> ```bash
> PROJECTS=$(cd app && bun -e 'import {FOLDERS} from "@/config"; console.log(FOLDERS.PROJECTS)')
> ```
> Then use `$PROJECTS/<project>/...` in any file operation. If `projects/` lives at the repo root, both forms resolve to the same place.

### 1. Confirm the archive is warranted
- Read `$PROJECTS/<project>/README.md` and list `$PROJECTS/<project>/tasks/`
- Check for open tasks:
  ```
  cd app && mcp__plugin_agent-kevin_kevin__task_query --project <project> --status open
  ```
- If open tasks exist, ask the user whether to close, cancel, or carry them forward before continuing. **Read the task threads before recommending** — if prior thread notes already say "should be closed / superseded / no longer applies", cancel-with-pointer-note is almost always the right call, even if the user's first instinct is "move them". Don't silently carry stale scope into the successor project.
- If the archive is a pivot (e.g., "going with X route instead"), consider creating a single *fresh* replacement task in the successor project — scoped to the new regime — rather than copy-pasting old tasks. Copy-pasted tasks tend to get closed on first review.
- Check for secrets the user probably doesn't want in `archive/`:
  ```
  ls "$PROJECTS/<project>"/.env* "$PROJECTS/<project>"/**/.env* 2>/dev/null
  ```
  If found, flag them to the user and ask whether to delete before moving.

### 2. Write final thoughts into the project README
- Add a banner at the top of `$PROJECTS/<project>/README.md` (immediately after the frontmatter if present, else at the very top):
  ```
  > **Status: Archived** (YYYY-MM-DD) — <one-line reason>.
  > Final artefacts live here; no further work is planned.
  ```
- Append a `## Final Thoughts` section at the bottom covering:
  - What shipped (concrete deliverables)
  - Reusable patterns lifted to the flywheel (link to concepts if promoted)
  - What would be done differently next time
  - Why it's being retired now

### 3. Strip references from active surfaces
Check and edit each of these. Skip any that don't contain the project:

- **HEARTBEAT.md** — remove the project name from any hardcoded project lists (e.g., the `weekly-goals` prompt). If a task exists solely for this project (its own `###` block), remove the whole task block, not just a list entry.
- **CLAUDE.md** — remove the row from the prefix map table (`## Task Management` → Prefix Map).
- **app/src/config.ts** — remove the entry from `TASK_PREFIX_MAP` (feeds the exported `TASKS.PREFIX_MAP`).
- Grep for stragglers across the repo. Expected survivors (leave alone):
  - `knowledge/raw/sessions/*.md` — point-in-time records
  - `knowledge/raw/archive/` — historical archive
  - `Projects/<other>/tasks/archive/*.md` — cross-project archived task files that mention the retiring project are historical records; leave alone
  - Files inside the project itself (they'll move with it in step 4)
- Worth actually editing (in addition to the four files above):
  - **Stale comments and log strings** in active code that name the project (e.g., JSDoc like `"else rd-tax fallback"`, log formatters like `"(fallback→rd-tax)"`). These aren't broken code, but they describe current runtime behavior and should stay truthful. Grep picks them up.

### 4. Move the folder
```
mkdir -p archive
mv "$PROJECTS/<project>" archive/<project>
```

### 5. Log the archival
Append to `knowledge/raw/sessions/YYYY-MM-DD.md` (or `YYYY-MM-DD-cli.md` for CLI sessions — match the filename convention already present in that folder for the day; create the file if today has no session file yet):
```
## Archived: <project>
- Reason: <one-line>
- Moved to: archive/<project>
- Final deliverable: <what shipped>
- References removed from: HEARTBEAT.md, CLAUDE.md, config.ts
- Reusable patterns: <list or "none">
```

### 6. Refresh the knowledge index
```
cd app && mcp__plugin_agent-kevin_kevin__compile_next
```
This runs `syncProjectIndex()` (see `app/src/knowledge/utils.ts`) which regenerates the `## Projects` table in `knowledge/index.md` from the current contents of `projects/` — the archived project drops off automatically. `syncProjectIndex()` is deterministic and will update the index even if the LLM-backed session compile fails (e.g., "Not logged in").

If the whole compile command errors, fall back to manually editing `knowledge/index.md` (delete the row from the Projects table).

### 6a. Repoint dangling project links in compiled knowledge
Compiled articles under `knowledge/concepts/` and `knowledge/concepts/` may still link to `../projects/<project>/README.md`. Those 404 now.

- Use Grep with path `knowledge/concepts/` and `knowledge/concepts/`, pattern `Projects/<project>`
- For each hit, rewrite the path from `.../projects/<project>/` to `.../archive/<project>/` and add an inline `_Archived YYYY-MM-DD._` marker so readers see the status at a glance
- Wikilinks of the form `[[Projects/<project>]]` in compiled articles need the same treatment — rewrite to `[[archive/<project>]]` or to an explicit markdown link

This is mechanical link repointing, not content editing. Leave raw session files (`knowledge/raw/`) alone.

### 7. Verify
Run all of these. Anything red = stop and fix.

- Grep the project name across active paths — should return zero hits:
  ```
  CLAUDE.md HEARTBEAT.md app/ .claude/ knowledge/index.md knowledge/memory/ knowledge/concepts/ knowledge/concepts/
  ```
- `archive/<project>/` exists, `$PROJECTS/<project>/` does not.
- `knowledge/index.md` Projects table no longer lists the project.
- Task scanner runs clean:
  ```
  cd app && mcp__plugin_agent-kevin_kevin__task_scan
  mcp__plugin_agent-kevin_kevin__task_query --project <project>    # should return "No tasks match"
  ```
- No new lint regressions (optional but recommended):
  ```
  cd app && mcp__plugin_agent-kevin_kevin__lint_structural:structural
  ```
  Compare issue count to before the archive. New broken-link errors mean step 6a missed something.

### 8. Summarize
Report to the user:
- What was moved
- Every surface that was edited (name each file)
- Any stragglers that were intentionally left (with reason)
- Anything flagged for manual follow-up (secrets in .env, workspace configs, external references)

## Not covered by this skill
- Deleting the project entirely (archiving preserves history on purpose)
- Rolling work into another project (do that first, then archive the empty husk)
- Notifying external stakeholders — do that manually if anyone outside the repo cares
- Removing secrets from the project's `.env` files — flag to the user in step 1; don't auto-delete

## Edge cases and gotchas
- **`USER.md` references**: if `<HOME>/USER.md` mentions the project, repoint or remove the reference manually.
- **Dangling wikilinks**: post-archive, any `[[Projects/<slug>]]` references in the wiki won't resolve. Run `mcp__plugin_agent-kevin_kevin__links_rewrite` to surface and patch them.
- **Shared-prefix conflicts**: removing a prefix from `TASKS.PREFIX_MAP` in `mcp-server/src/config.ts` is safe — existing archived task files keep their IDs (stored in frontmatter), and no new tasks for that project can be created accidentally.
