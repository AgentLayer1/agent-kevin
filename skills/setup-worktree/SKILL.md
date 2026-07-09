---
name: setup-worktree
description: Create a git worktree for parallel agent work and bootstrap it so it's ready to code — copies the gitignored local files (`.env*`, `.claude/settings.local.json`, `.cursor`, `.cmux`) from the main checkout, installs dependencies, and builds the packages. Use whenever the user asks to spin up a worktree, work on a branch in parallel, set up an isolated checkout for another agent, or "make a worktree for <feature>". First pins down WHICH repo the worktree is for (the user's words, the `$KEVIN_CODE_PATH` default when they assume you know, or by asking when neither resolves), then creates the worktree as a sibling of that repo, never nested inside it, and offers to add it to a sibling `*.code-workspace` if one exists.
allowed-tools: mcp__plugin_agent-kevin_kevin__setup_worktree, mcp__plugin_agent-kevin_kevin__remove_worktree, mcp__plugin_agent-kevin_kevin__database_fork, mcp__plugin_agent-kevin_kevin__database_list, mcp__plugin_agent-kevin_kevin__database_query, Bash, Read, Edit
---

# setup-worktree — parallel checkout, ready to code

Stand up a [git worktree](https://git-scm.com/docs/git-worktree) so a second agent can work a
branch in parallel without touching the main checkout's files. Pin the repo, then hand the create
+ bootstrap to the `setup_worktree` MCP tool in one call.

**Why the tool, not raw `git worktree add` in Bash:** the Bash command sandbox denies the writes
`git worktree add` must make — it rewrites the main repo's `.git/config` and checks out tracked
config files (`.vscode/settings.json`, `.mcp.json`). The MCP server runs *outside* that sandbox
(like `browser_flows`), so the tool gets those writes through.

## Step 0 — pin the target repo

The worktree is always of one specific repo. A HOME can sit above several repos, so figure out
which one before doing anything:

1. **The user named it** ("a worktree for acme-mono", "for the agent repo", "of this repo") —
   use that repo. An explicit name always wins over the default below.
2. **The user assumes you know the repo + `$KEVIN_CODE_PATH` is set** ("make me a worktree for
   the dark-mode work", no repo named) — use `$KEVIN_CODE_PATH` as the default repo. That env var
   is the operator's primary codebase (captured at init), so it's the repo they mean when they
   don't say which. State which repo you picked so a wrong default gets caught before the cleanup.
3. **Otherwise, ask. Always.** This covers an unset/empty `$KEVIN_CODE_PATH`. Do not infer the
   repo from cwd. The agent HOME is itself almost always a git repo (it versions `knowledge/` and
   `projects/`), so cwd being inside a git repo does NOT make it the intended code repo. List the
   candidate code repos (e.g. the git repos under `tech/`) and let the user pick. The wrong repo
   is an annoying cleanup.

Resolve the chosen repo to the **absolute path of its main checkout**. (If you're standing in a
worktree of it, the tool still resolves the real main checkout from `git worktree list` — but pass
the main checkout when you can, to keep paths predictable.)

## Step 1 — create + bootstrap via the tool

Call `mcp__plugin_agent-kevin_kevin__setup_worktree` with:

- `repoPath` — absolute path to the repo's main checkout (from Step 0).
- `branch` — a short, descriptive branch name from what the user is doing; ask only if genuinely
  ambiguous. **Do not add a type prefix** (`feat/`, `chore/`, `test/`); the operator's name is the
  branch folder. The name is always namespaced under the operator (e.g. `my-thing` →
  `basem/my-thing`, derived from git identity); a name already under that namespace is kept as-is.
  An existing branch is checked out as-is.
- `baseBranch` (optional) — explicit branch/ref to start the new branch from. Defaults to the first
  of `dev` → `develop` → `main` → `master` that exists locally, falling back to the main checkout's
  current branch.
- `slug` (optional) — folder suffix for the worktree dir. Defaults to the branch's last path
  segment, producing `<repo>-<slug>` as a **sibling** of the main checkout (never nested).
- `extraInstalls` (optional) — relative subdirs with their own lockfile that need a separate
  install (e.g. `["packages/standalone-cli"]`).

The tool creates the sibling worktree, copies the gitignored locals (every `.env`/`.env.*`, every
`.claude/settings.local.json`, every `.cmux`, plus root `.cursor`/`.cursorignore`), detects the
package manager, installs, and runs the first build script it finds (`build` → `build:packages` →
`build:libs`). It returns `{ worktreePath, branch, branchExists, baseBranch, copied,
packageManager, built, extraInstalled, steps }`.

**Check `steps` for any `ok: false`** (each carries a tail of the command output) before you call
the setup a success.

## Step 2 — offer to add it to the VS Code workspace

If the target repo has a VS Code workspace file alongside it (a `*.code-workspace` in the repo's
parent dir, the sibling level where the worktree was just created), the operator likely keeps all
their checkouts open in one window. Offer to add the new worktree to it:

1. Glob the parent dir (`dirname(repoPath)`) for `*.code-workspace`. None found: skip this step,
   no need to mention it.
2. One or more found: ask the operator whether you should add the new worktree folder to it (name
   the file). Only proceed on a yes.
3. On yes, `Read` the workspace file and `Edit` a new entry into its `folders` array pointing at
   the worktree. Paths in `folders` are relative to the workspace file's own location, so use the
   worktree dir's basename (it's a sibling of the file). Match the existing entries' shape (a bare
   `{ "path": "..." }`, plus a `"name"` if the others carry one). Leave every other key
   (`settings`, `extensions`, the existing folders) untouched.

This is a plain JSON edit, not the MCP tool's job: do it with `Read` + `Edit`.

## Step 3 — confirm and hand off

Report the `worktreePath`, `branch`, and the `baseBranch` it branched from, surface any failed
`steps`, then point the next agent (or a cmux workspace) at it. When the branch lands, tear it down
with the drop flow below.

## Dropping a worktree

When the operator asks to **drop / delete / remove / tear down** a worktree, use the
`remove_worktree` MCP tool — not raw `git worktree remove` in Bash (same sandbox block: removal
rewrites the main repo's `.git/config`). The tool does the authoritative safety checks; you own the
conversational gates around them.

**Always confirm before removing — it's destructive.** Even when the tree looks clean, never call
`remove_worktree` on an inferred or ambient go-ahead: get an explicit yes for *this* removal. Two
gates back you up here — your confirmation, and the fact that `remove_worktree` is intentionally
**not** in the pre-granted permissions, so Claude Code shows its own approval prompt before the tool
runs. Keep it that way (don't add it to any allowlist); the harness prompt is a deliberate second
safety net on a destructive op.

Flow:

1. **Confirm first.** State what you're about to remove — the `worktreePath` and its `branch` — and
   ask the operator to confirm. If they didn't mention the branch, ask in the same breath whether to
   delete it too or keep it. Only proceed on an explicit yes.
2. **Dry-run pre-check.** Call `mcp__plugin_agent-kevin_kevin__remove_worktree` with `dryRun: true`
   (plus `worktreePath`). It reports the `status` **without touching anything** — so you learn whether
   the removal is blocked before you unwire the workspace:
   - **`blocked-uncommitted`** — the worktree has uncommitted changes. **Stop.** Tell the operator it
     can't be removed and they need to commit (or stash/discard) first. `force` does **not** override
     this — never pass it to bypass uncommitted work. The `uncommitted` array lists the dirty paths.
   - **`blocked-unpushed`** — everything's committed but the branch has `unpushed` commits on no
     remote. **Warn and ask**: "That branch has N commit(s) not pushed anywhere — remove it anyway?"
     Only on an explicit yes, carry `force: true` into the steps below.
   - **`removable`** — the gates pass; go ahead.
3. **Unwire it from the VS Code workspace, if it's there** (mirror of create Step 2). Only reached once
   the pre-check says `removable`, so you never yank a folder the operator is still working in. Glob the
   worktree's parent dir (`dirname(worktreePath)`, the sibling level) for `*.code-workspace`. For each
   one, `Read` it and check whether its `folders` array has an entry pointing at this worktree (a
   `path` matching the worktree dir's basename). If so, `Edit` that single entry out, leaving every
   other key (`settings`, `extensions`, the other folders) untouched — a surgical JSON edit, not the
   MCP tool's job. Do this **before** the real removal so the workspace never references a folder that's
   about to be cleaned and deleted. No workspace file, or no matching entry: skip silently.
4. **Drop the DB fork, if there is one** (the teardown counterpart of create Step 4). Most worktrees run
   on the shared DB — nothing to drop. A schema-work worktree got a private fork from `database_fork`,
   and it must be dropped **before** the removal, while its `.env.local` override still exists. Detect it
   **server-side** — do NOT read `<worktree>/.env.local` (it's covered by the secrets deny-read rule, so
   the read just gets denied): `database_query` `pg_database` for a `<source>_<branch-slug>`-named
   database matching this worktree's branch. Fork found → `database_fork` with
   `{ drop: true, cwd: <worktreePath>, repointEnv: true }` (it runs outside the sandbox, so it removes
   the `.env.local` override itself). No fork on the server → skip and say "shared DB, nothing to drop."
   Teardown never touches the shared DB.
5. **Remove for real.** Call `remove_worktree` again with the `worktreePath`, `force: true` if the
   pre-check needed it, and `deleteBranch: true` only if the operator asked to delete the branch. It
   runs the repo's `clean` script (e.g. `pnpm run clean`), then removes the worktree **without**
   `git worktree remove --force` — so git's own dirty/lock check still applies:
   - **`removed`** — success. Check `steps` for any `ok: false` (e.g. the `clean` run).
   - **`failed`** — git refused the removal (worktree dirty or locked) or a leftover couldn't be
     deleted; **nothing was force-removed**. Surface the `steps` output. On native Windows a leftover
     usually means a locked dir — close any editor/dev server holding it and retry. (Process-lock
     recovery and orphan sweep are out of scope; WSL2 is the tested path.)

**The branch is never deleted by default.** `remove_worktree` only removes the worktree; the branch
survives. Pass `deleteBranch: true` only when the operator explicitly asked to delete the branch too.
If they **didn't** mention the branch, ask after a successful removal: "Delete the `<branch>` branch
too, or keep it?" — and only re-call with `deleteBranch` on a yes. (When the removal took `force`, the
tool force-deletes the branch with `-D`, since an unpushed branch won't `-d`; `branchDeleteError`
carries any failure.)

### Report the outcome

Close with one tidy summary distilled from the result — never paste the raw JSON or the full `steps`
dump. A status header, then one aligned line per action that actually ran (skip lines for things that
didn't apply rather than printing "n/a"). Terminal-native: ASCII + a light 🍌, no wall of tables.

```
🍌 Worktree removed — acme-mono-darkmode

   remove     git worktree remove ✓
   clean      pnpm run clean ✓
   workspace  unwired from acme.code-workspace
   db fork    shared DB — nothing to drop
   branch     basem/darkmode — deleted
```

Always show the `branch` line as `kept` or `deleted` so its fate is explicit. For a `blocked-*`
status, lead with **why** it stopped and the one thing to do next (commit first / confirm the unpushed
removal) — don't render the success block. For `failed`, say git refused (dirty/locked) or the husk
couldn't be deleted, name it, and surface the failing `steps` line; never imply it was removed.

## Step 4 — optional: fork the database for schema work

Only relevant for repos that run a **shared local database** dev model (one Postgres DB every
worktree points at, so a fresh worktree's copied `.env*` already targets it — no per-worktree DB
step). The default is correct for most branches. But a worktree that will run **migrations or
mutate the schema** must NOT touch the shared DB. For those, fork it: provision a private database
seeded from a recent dump, then repoint the worktree's `.env.local` at the fork.

The generic `database_fork` MCP tool does the provisioning (it forks any local database, not just a
worktree's — see its own description). It clones the shared DB into a private `<source>_<branch>`
with `CREATE DATABASE ... TEMPLATE` (pure SQL — no `pg_dump`/`pg_restore` binaries, no dump file,
cross-platform, instant), then writes a `.env.local` override so the worktree points at the fork.
For the worktree case, call it after Step 1 with:

- `cwd` — the `worktreePath` from `setup_worktree`. Names the fork after the worktree's branch AND
  is where the `.env.local` override is written.
- `repointEnv: true` — write the `.env.local` DB override in `cwd` (the app layers it over `.env`).
  If `.env.local` already sets the var (a value the dev put there), the tool leaves it untouched
  and returns `envInstruction` telling you to point it at the fork by hand; pass `force: true` to
  overwrite instead. Relay that instruction to the user verbatim when it comes back.
- `connection` (optional) — the `KEVIN_DB_<NAME>` connection for the repo's local server; omit to
  use the first configured connection (see below).
- `terminateSource` (optional) — disconnect live sessions on the shared DB so the clone can proceed
  (a running dev server holds connections; the tool errors with this hint if blocked).
- `force` (optional) — recreate the fork if it already exists.

The fork name defaults to `<source>_<branch-slug>` (from `cwd`'s git branch) and the override var to
`DATABASE_URL`. The override is isolated — the base `.env` is never touched. To tear the fork down,
call again with `drop: true` + the same `cwd`/`repointEnv` (drops the DB and removes the override) —
do this before `git worktree remove` so the
fork isn't orphaned. Remote connections are refused; `database_fork` only acts on a local server.

**Resolving the source connection (the generic seam):** the tool needs a `KEVIN_DB_<NAME>`
connection pointing at the repo's local Postgres server (e.g.
`KEVIN_DB_ACME=postgresql://postgres:@localhost:5432/acme` in **`.kevin/secrets/.env`** — since
v0.3.0 credential env vars live there, not in `.claude/settings.local.json`). It defaults to the
first configured connection; when a repo has several, pick the right one in this order:

1. A declaration in the **repo's root `CLAUDE.md`** — a line of the form
   `Worktree DB connection: <kevin-db-name>` (e.g. `acme`).
2. If the repo doesn't declare one and **`$KEVIN_CODE_PATH` is set**, check that repo's `CLAUDE.md`
   for the same line.
3. Otherwise run `database_list` and, if exactly one connection matches the repo's local server, use it;
   if it's ambiguous or none is configured, **ask the operator** (and have them add the
   `KEVIN_DB_<NAME>` env var to `.kevin/secrets/.env`) — don't guess.

## Notes

- The main checkout must already have its `.env*` files in place — that's the copy source.
- `setup_worktree` is **create-only**: it refuses if the worktree dir already exists. To rebuild an
  existing worktree, remove it (the drop flow above / `remove_worktree`) and recreate.
- Repos without a `package.json` just get the file copy; install/build no-op.
- Outside Claude Code, the same logic is on the CLI: `kevin worktree <repoPath> --branch=...
  [--slug=...] [--extra=sub1,sub2]` to create, `kevin worktree remove <worktreePath>
  [--delete-branch] [--force]` to drop. That path is for a real terminal — under the Bash sandbox
  the MCP tools are the only way (the CLI would hit the same `.git/config` write block).
