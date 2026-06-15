---
name: create-project
description: Spin up a new project under projects/<slug>/ with a README, tasks folder, and a 2-letter task prefix registered with the MCP server. Use when the user says "create a new project called X", "start a project for Y", or otherwise declares a new multi-artefact initiative worth its own folder.
---

# Create Project

Stand up a new project so it shows up in the knowledge index, the task CLI, and the flywheel — with the right prefix and scaffolding from the start.

## When to use
- User explicitly asks to create, start, or spin up a new project
- The work genuinely needs its own folder: multiple docs, tasks, or a long-lived deliverable
- **Don't use for:** one-off tasks (those go in an existing project's `tasks/`) or quick research notes (drop them under `<HOME>/knowledge/raw/inbox/` — or use `kevin capture` — for compilation)

## Inputs (ask if missing, don't guess)
- `<name>` — human title (e.g., "Halal Finance Tracker")
- `<slug>` — folder name, lowercase-with-hyphens (e.g., `halal-finance`); derive from name and confirm
- `<prefix>` — 2-letter task ID prefix (e.g., `hf`); propose one and confirm it doesn't collide
- `<one-line>` — vision/purpose in one sentence; used for the banner under the title

## Why this design
- `<HOME>/projects/<slug>/` is the single source of truth. The MCP server's `syncProjectIndex()` scans `projects/` and regenerates the `## Projects` table in `knowledge/index.md` deterministically on every compile — no manual index edit needed.
- The 2-letter prefix is registered in `mcp-server/src/config.ts` `TASKS.PREFIX_MAP` (enforced by the task CRUD path). Missing it causes `mcp__plugin_agent-kevin_kevin__task_create` to fail.
- Tasks folder exists from day one so `mcp__plugin_agent-kevin_kevin__task_scan` and the Obsidian dashboard don't special-case empty projects.

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
- Resolve collisions:
  - Slug collision: `ls "$PROJECTS/<slug>"` should not exist. If it does, stop and ask.
  - Prefix collision: grep `PREFIX_MAP` in `mcp-server/src/config.ts`. If the proposed 2-letter prefix is already taken, propose an alternative (take first letters of compound words, or first + last).

### 2. Pick sensible defaults
- Prefix: first letter of each hyphen-separated word in the slug, trimmed to 2 chars. (`halal-finance` → `hf`; `pray-watch` → `pw`; single-word `homeschool` → `hs` from first-last).
- Status line: `Created <YYYY-MM-DD> — <one-line vision>.`

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

### 4. Register the prefix in config

Edit `mcp-server/src/config.ts` — add the entry to `TASKS.PREFIX_MAP`, keep it alphabetized:
```ts
'<slug>': '<pfx>',
```

Quote the key if the slug contains a hyphen.

### 5. Refresh the knowledge index

Run the project sync (the next compile will do this automatically, but you can trigger it explicitly via the MCP server's `syncProjectIndex`, or by calling `mcp__plugin_agent-kevin_kevin__compile_next` if you have pending work).

### 6. Verify

Run all of these. Anything red = stop and fix.

- `$PROJECTS/<slug>/README.md` exists.
- `$PROJECTS/<slug>/tasks/` exists.
- `grep -n "'<slug>':" mcp-server/src/config.ts` returns a hit in `PREFIX_MAP`.
- Task CLI recognises the project:
  ```
  mcp__plugin_agent-kevin_kevin__task_query with {project: "<slug>"}
  ```
  Expect an empty result — a clean `count: 0`, **not** an "unknown project" error.

### 7. Summarize
Report to the user:
- Slug, prefix, one-line vision
- Every file created or edited (name each one)
- Next natural step, e.g. "create your first task: `mcp__plugin_agent-kevin_kevin__task_create` with project=<slug>, title=..., description=..."

## Not covered by this skill
- Creating code scaffolding (package.json, src/, tests) — this skill makes the *project folder*, not the codebase. Add code as a separate step when you know the stack.
- External resources (domains, Stripe accounts, channels) — flag to the user; don't auto-create.
- Migrating an existing folder into `projects/` — use plain `mv` and then run steps 4–6 manually; this skill assumes a fresh slug.

## Edge cases and gotchas
- **Prefix < 2 chars**: never. All existing prefixes are exactly 2 letters. Pad with a second letter from the slug if needed.
- **Slug already archived**: check archive locations too. Re-using an archived slug collides in the compiled index. Ask the user for a distinct slug.
- **Don't seed tasks during creation** unless the user asked. Empty `tasks/` is the correct starting state.
