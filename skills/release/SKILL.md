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

**Manual** — anything a consumer must do by hand that can't be automated (a one-time
data migration, an external re-auth) → `` `manual: none` `` with clear instructions.

If none of the above apply, the Upgrade block is the single line:
`None — code-only, no bun install or HOME changes.`

## Step 3 — Decide the new version

Propose a bump from the change magnitude (SemVer), and confirm with the maintainer:
- **patch** — fixes only, no new surface.
- **minor** — new skills/tools/features, backward-compatible.
- **major** — breaking changes to home layout, settings, or contracts.

Bump `.claude-plugin/plugin.json` `version` to the chosen value (edit that one field).

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

## Step 5 — Stage, then STOP for approval

Show the maintainer the full diff to be committed:

```bash
git --no-pager diff -- .claude-plugin/plugin.json CHANGELOG.md
git status --short
```

Propose:
- a commit (message e.g. `Release vX.Y.Z`),
- an annotated tag `vX.Y.Z`,
- and (if asked) a push to the marketplace remote.

**Then stop and ask.** Do not run `git commit`, `git tag`, or `git push` until the
maintainer explicitly approves. On approval:

```bash
git add .claude-plugin/plugin.json CHANGELOG.md   # + any release-scoped files
git commit -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
# only if explicitly asked:
# git push && git push --tags
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
