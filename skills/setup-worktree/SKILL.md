---
name: setup-worktree
description: Create a git worktree for parallel agent work and bootstrap it so it's ready to code — copies the gitignored local files (`.env*`, `.claude/settings.local.json`, `.cursor`, `.cmux`) from the main checkout, installs dependencies, and builds the packages. Use whenever the user asks to spin up a worktree, work on a branch in parallel, set up an isolated checkout for another agent, or "make a worktree for <feature>". First pins down WHICH repo the worktree is for (the user's words, the current repo, or by asking when a HOME holds several repos), then creates the worktree as a sibling of that repo, never nested inside it.
allowed-tools: mcp__plugin_agent-kevin_kevin__setup_worktree, Bash, Read
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
   use that repo.
2. **Otherwise, ask. Always.** Do not infer the repo from cwd. The agent HOME is itself almost
   always a git repo (it versions `knowledge/` and `projects/`), so cwd being inside a git repo
   does NOT make it the intended code repo. List the candidate code repos (e.g. the git repos
   under `tech/`) and let the user pick. The wrong repo is an annoying cleanup.

Resolve the chosen repo to the **absolute path of its main checkout**. (If you're standing in a
worktree of it, the tool still resolves the real main checkout from `git worktree list` — but pass
the main checkout when you can, to keep paths predictable.)

## Step 1 — create + bootstrap via the tool

Call `mcp__plugin_agent-kevin_kevin__setup_worktree` with:

- `repoPath` — absolute path to the repo's main checkout (from Step 0).
- `branch` — a short, descriptive branch name from what the user is doing; ask only if genuinely
  ambiguous. A bare name (no `/`) is namespaced under the operator (e.g. `my-thing` →
  `basem/my-thing`, derived from git identity); pass an already-namespaced name (contains `/`) to
  keep it verbatim. An existing branch is checked out as-is.
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

## Step 2 — confirm and hand off

Report the `worktreePath`, `branch`, and the `baseBranch` it branched from, surface any failed
`steps`, then point the next agent (or a cmux workspace) at it. When the branch lands, clean up
with `git worktree remove <worktreePath>`.

## Notes

- The main checkout must already have its `.env*` files in place — that's the copy source.
- The tool is **create-only**: it refuses if the worktree dir already exists. To rebuild an
  existing worktree, remove it (`git worktree remove <path>`) and recreate.
- Repos without a `package.json` just get the file copy; install/build no-op.
- Outside Claude Code, the same logic is on the CLI: `kevin worktree <repoPath> --branch=...
  [--slug=...] [--extra=sub1,sub2]`. That path is for a real terminal — under the Bash sandbox the
  MCP tool is the only way (the CLI would hit the same `.git/config` write block).
