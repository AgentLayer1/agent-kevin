---
name: create-project
description: Spin up a new project under projects/<slug>/ with a README and tasks folder. The 2-letter task prefix is derived from the slug automatically — no config edit. Use when the user says "create a new project called X", "start a project for Y", or otherwise declares a new multi-artefact initiative worth its own folder.
---

# Create Project

Stand up a new project so it shows up in the knowledge index, the task CLI, and the flywheel — with the right scaffolding from the start. The task prefix is derived from the slug at runtime (no registration step).

## When to use
- User explicitly asks to create, start, or spin up a new project
- The work genuinely needs its own folder: multiple docs, tasks, or a long-lived deliverable
- **Don't use for:** one-off tasks (those go in an existing project's `tasks/`) or quick research notes (drop them under `<HOME>/knowledge/raw/inbox/` — or use `kevin capture` — for compilation)

## Inputs (ask if missing, don't guess)
- `<name>` — human title (e.g., "Halal Finance Tracker")
- `<slug>` — folder name, lowercase-with-hyphens (e.g., `halal-finance`); derive from name and confirm
- `<one-line>` — vision/purpose in one sentence; used for the banner under the title

The 2-letter task prefix is **not an input** — it's derived from the slug (see step 2). You don't choose or register it; you just tell the user what it'll be.

## Why this design
- `<HOME>/projects/<slug>/` is the single source of truth. The MCP server's `syncProjectIndex()` scans `projects/` and regenerates the `## Projects` table in `knowledge/index.md` deterministically on every compile — no manual index edit needed.
- The 2-letter prefix is **derived from the filesystem**, not registered anywhere. `getProjectPrefix()` in `mcp-server/src/tasks/scan.ts` prefers the most-used prefix among existing task filenames, and falls back to deriving from the slug for an empty project. The old hardcoded `TASKS.PREFIX_MAP` in `config.ts` is gone. Nothing to edit — the prefix exists the moment the folder does.
- Tasks folder exists from day one so `mcp__plugin_agent-kevin_kevin__task_scan` and the Obsidian dashboard don't special-case empty projects, and so prefix derivation has a directory to look at.

## Protocol

Steps 1–2 are reversible. After step 3 (folder creation), stay deliberate.

> **Path note:** Resolve the absolute path once at the top of your session:
> ```bash
> PROJECTS=$(bun -e 'import { FOLDERS } from "'"$CLAUDE_PLUGIN_ROOT"'/mcp-server/src/config"; console.log(FOLDERS.PROJECTS)')
> ```
> Then use `$PROJECTS/<slug>/...` in any file operation.

### 1. Gather and confirm inputs
- **Confirm with the user before creating** — starting a new project is an "ask first" boundary. One-liner is fine:
  > "Creating `projects/<slug>/` with prefix `<pfx>`. One-line vision: `<one-line>`. Proceed?"

  (Compute `<pfx>` first using the rule in step 2 — it's derived from the slug, not chosen.)
- Resolve collisions:
  - Slug collision: `ls "$PROJECTS/<slug>"` should not exist (check `archive/` too — see edge cases). If it does, stop and ask.
  - Prefix collision is handled automatically: `buildPrefixMap()` appends a numeric suffix (`hs` → `hs2`) when two projects derive the same prefix. You don't need to pre-check, but if the derived prefix would collide and you'd rather avoid the suffix, pick a slug that derives a distinct prefix.

### 2. Compute the derived prefix (so you can tell the user)
The prefix is whatever `getProjectPrefix()` will return for an empty project — derived from the slug:
- **2+ hyphen-separated parts:** first letter of the first two parts (`halal-finance` → `hf`, `pray-watch` → `pw`, `agent-layer` → `al`).
- **Single word:** first two letters (`acme` → `ac`, `homestead` → `ho`).

You don't write this anywhere — it's computed at runtime. Just surface it in the confirmation and summary. Status line: `Created <YYYY-MM-DD> — <one-line vision>.`

### 3. Create the project folder

```bash
mkdir -p "$PROJECTS/<slug>/tasks"
```

Write `$PROJECTS/<slug>/README.md`:
```markdown
# <Name>

> **Status: Active** (YYYY-MM-DD) — <one-line vision>.

## Vision

<one paragraph expanding on the one-liner — what this project is, why it exists>

## Current Focus

- <1–3 bullets of what's being tackled right now; "TBD" is fine at creation time>

## Structure

- `README.md` — this file
- `tasks/` — task files (see CLAUDE.md → Task System)

<Add sections as the project grows. Don't pre-create empty folders.>
```

Keep the README tight. Resist the urge to pre-populate sections you don't have content for — empty `## Roadmap`, `## Architecture`, etc. rot fast.

### 4. Refresh the knowledge index

Run the project sync (the next compile will do this automatically, but you can trigger it explicitly via the MCP server's `syncProjectIndex`, or by calling `mcp__plugin_agent-kevin_kevin__compile_next` if you have pending work).

### 5. Verify

Run all of these. Anything red = stop and fix.

- `$PROJECTS/<slug>/README.md` exists.
- `$PROJECTS/<slug>/tasks/` exists.
- Task CLI recognises the project and the derived prefix is what you expected:
  ```
  mcp__plugin_agent-kevin_kevin__task_query with {project: "<slug>"}
  ```
  Expect an empty result — a clean `count: 0`, **not** an "unknown project" error.

### 6. Summarize
Report to the user:
- Slug, prefix, one-line vision
- Every file created or edited (name each one)
- Next natural step, e.g. "create your first task: `mcp__plugin_agent-kevin_kevin__task_create` with project=<slug>, title=..., description=..."

## Not covered by this skill
- Creating code scaffolding (package.json, src/, tests) — this skill makes the *project folder*, not the codebase. Add code as a separate step when you know the stack.
- External resources (domains, Stripe accounts, channels) — flag to the user; don't auto-create.
- Migrating an existing folder into `projects/` — use plain `mv`, make sure it has a `tasks/` folder, then verify (step 5); this skill assumes a fresh slug. The prefix is derived from any existing task filenames, so a migrated folder keeps its old prefix automatically.

## Edge cases and gotchas
- **Prefix length**: `derivePrefix()` always yields 2 chars (a single-letter slug like `x` would yield `x` — don't create one-letter slugs).
- **Slug already archived**: check `archive/` too. Re-using an archived slug collides in the compiled index, and prefix derivation could see stale task files. Ask the user for a distinct slug.
- **Don't seed tasks during creation** unless the user asked. Empty `tasks/` is the correct starting state.
