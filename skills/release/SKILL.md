---
name: release
description: Producer-only. Cut a versioned release of the agent-kevin plugin — analyze commits since the last release, detect what consumers must do to upgrade (bun install, settings, template/HOME changes), bump plugin.json, prepend a CHANGELOG entry with a machine-actionable Upgrade block, and stage the commit + tag for approval. Use when the maintainer says "cut a release", "release kevin", "ship a new version", "bump the version and update the changelog". Not for consumers — they use /agent-kevin:upgrade.
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit
---

# Release — cut a versioned plugin release

Maintainer tool. Produces the **contract** that `/agent-kevin:upgrade` consumes:
a bumped `plugin.json` version + a `CHANGELOG.md` entry whose `### Upgrade` block
tells every consumer exactly what their home needs after they `/plugin update`.

Runs against the plugin repo at `${CLAUDE_PLUGIN_ROOT}`. **Never commits, tags, or
pushes without explicit approval** — it stages everything and stops (per the
standing "one approval ≠ blanket commit license" rule).

## Step 0 — Locate the plugin repo + last release

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
cd "$PLUGIN_ROOT" || exit 1
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "not a git repo"; exit 1; }
CURRENT=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' .claude-plugin/plugin.json | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
LAST_TAG=$(git tag --list 'v*' --sort=-v:refname | head -1)
echo "current plugin.json version: $CURRENT"
echo "last tag: ${LAST_TAG:-<none>}"
git status --short
```

Determine the **last release point**, in order of preference:
1. the latest `v*` git tag (if any),
2. else the newest `## [x.y.z]` in `CHANGELOG.md`,
3. else the current `plugin.json` version (first-ever release).

If the working tree is dirty, decide with the maintainer whether those changes are
part of this release (usually yes) before proceeding.

## Step 1 — Gather changes since the last release

```bash
RANGE="${LAST_TAG:+$LAST_TAG..}HEAD"   # tag..HEAD, or all of HEAD if no tag
git log --oneline --no-merges $RANGE
git diff --stat $RANGE
```

Read the commit subjects + the changed-file list. Group the human-facing notes into
**Added / Changed / Fixed / Removed** for the CHANGELOG body. Keep them terse and
operator-readable (what changed, not commit-by-commit).

## Step 2 — Detect upgrade actions (what a consumer's home needs)

Diff the paths to derive the `### Upgrade` block. Check each:

**Dependencies** — did the MCP server's deps change?

```bash
git diff $RANGE -- mcp-server/package.json mcp-server/bun.lock | grep -E '^\+' | grep -v '^\+\+\+' || echo "(no dep changes)"
```

If any dependency was added/changed → `` `deps: required` `` naming the new packages.

**Templates** — did any scaffolded-file source change?

```bash
git diff --stat $RANGE -- templates/
```

For each changed `templates/<file>`, emit `` `template/<file>: <severity>` ``. Propose
severity, let the maintainer confirm/override:
- `templates/CLAUDE.md` → **mandatory** (the operating manual is plugin-owned).
- `templates/SOUL.md`, `templates/IDENTITY.md` → **optional** (character files the
  operator personalizes) unless the change is functional, then mandatory.
- new `templates/rules/<x>.md`, new `templates/knowledge/concepts/<x>.md` → **additive**
  (emit as `` `file: additive` `` with the HOME destination path).

**Settings** — do new MCP tools or skills need `permissions.allow` entries?

```bash
git diff $RANGE -- mcp-server/src/tools/ | grep -E "name:\s*'[a-z_]+'" || true   # new defineTool names
git diff --stat $RANGE -- skills/                                                 # new skill dirs
```

A new always-on core tool, or a new model-invocable skill, needs a grant in consumer
`settings.json` → `` `settings: mandatory` `` naming the exact entries (e.g.
`mcp__plugin_agent-kevin_kevin__foo`, `Skill(agent-kevin:foo)`). Match the canonical
list in `skills/init/SKILL.md`.

**Scripts** — did this release add a version-pinned migration script?

```bash
git diff --name-only --diff-filter=A $RANGE -- skills/upgrade/scripts/ || true
```

A new `skills/upgrade/scripts/<X.Y.Z>.ts` is a heavy one-time HOME migration. Emit
`` `script: required` `` (or `optional`) naming the version, e.g.
`` `script: required` — run skills/upgrade/scripts/0.3.0.ts (moves secrets to .kevin/secrets/). ``
The script's filename **must** equal the version you bump to in Step 3 — that's the
naming convention (filename = the release the migration is applied when upgrading to)
and how `/agent-kevin:upgrade` finds it. So decide the bump (Step 3) and the filename
together: if you rename the bump, rename the script. A migration that relocates files or
strips settings is a **breaking** change — pre-1.0 that's a **minor** bump (`0.x` → `0.(x+1).0`),
post-1.0 a **major**; flag it in Step 3. Prefer a `script` over `manual` when the move
can be automated and verified.

**Manual** — anything a consumer must do by hand that *can't* be automated (an external
re-auth, a decision only they can make) → `` `manual: none` `` with clear instructions.
If a migration can be scripted, use `script`, not `manual`.

If none of the above apply, the Upgrade block is the single line:
`None — code-only, no bun install or HOME changes.`

## Step 3 — Decide the new version (ASK)

Compute the three candidate versions from the current `MAJOR.MINOR.PATCH` so the
maintainer sees exactly what each bump produces, then **ask** with the `AskUserQuestion`
tool — never pick the bump silently:

- **patch** → `MAJOR.MINOR.(PATCH+1)` — fixes only, no new surface.
- **minor** → `MAJOR.(MINOR+1).0` — new skills/tools/features, backward-compatible.
- **major** → `(MAJOR+1).0.0` — breaking changes to home layout, settings, or contracts.

Substitute the **real** current version into the option labels so each choice shows its
concrete target — e.g. if `plugin.json` is `0.2.2`, the options read `patch → 0.2.3`,
`minor → 0.3.0`, `major → 1.0.0`; if it's `0.4.7`, they read `0.4.8` / `0.5.0` / `1.0.0`.
Recommend the bump that matches the change magnitude from Steps 1–2 (put it first, label
it "(Recommended)"), but the maintainer's choice wins.

Then bump `.claude-plugin/plugin.json` `version` to the chosen value (edit that one field).

> Note: `mcp-server/package.json` carries its own, separate `version` that is not used
> for plugin versioning and has drifted — leave it unless the maintainer asks to sync it.

## Step 4 — Write the CHANGELOG entry

Prepend a new entry **below** the `<!-- Add new releases below this line -->` marker in
`CHANGELOG.md`, newest first:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Upgrade
- `deps: required` — new dep `foo`; run bun install in mcp-server.
- `settings: mandatory` — add permission `Skill(agent-kevin:foo)`.
- `template/CLAUDE.md: mandatory` — new "X" section.
```

Use today's date (`date +%Y-%m-%d`). Omit empty Added/Changed/Fixed groups. The Upgrade
block must list **every** action from Step 2 (or the code-only sentinel). This is the
exact text `/agent-kevin:upgrade` parses, so keep the backticked tags well-formed.

## Step 5 — Stage, show the diff, then ASK how far to go

The version + CHANGELOG edits are made, but **nothing in git has run yet**. Show the
maintainer the full diff to be committed:

```bash
git --no-pager diff -- .claude-plugin/plugin.json CHANGELOG.md
git status --short
```

Then **ask** with the `AskUserQuestion` tool how far to take it — never commit, tag, or
push without an explicit choice (per the standing "one approval ≠ blanket commit license"
rule). Offer exactly these options:

- **Commit only** — `git commit`, no tag, no push.
- **Commit + tag** — `git commit` then annotated `git tag vX.Y.Z`.
- **Commit + tag + push** — also `git push && git push --tags` to the marketplace remote.

("Other" lets the maintainer abort or hand-tune.) Then run **only** the chosen subset:

```bash
git add .claude-plugin/plugin.json CHANGELOG.md   # + any release-scoped files
git commit -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"      # commit+tag and above only
git push && git push --tags        # push option only
```

## Step 6 — Hand off

Remind the maintainer of the consumer upgrade path so it can go in release notes:

```
/plugin marketplace update <marketplace>
/plugin update agent-kevin@<marketplace>
# restart Claude Code, then:
/agent-kevin:upgrade
```

## Notes

- The dashboard's Changelog tab + the "upgrade available" badge read `CHANGELOG.md`
  and the consumer's `.kevin/version.json` automatically — no extra step here.
- Tags are the source of truth for "last release" once they exist; keep tagging every
  release so future `git log` ranges stay accurate.
- This skill is producer-only and slash-invoked. Consumers never run it.
