---
name: upgrade
description: Apply pending HOME migrations after a plugin code update. `/plugin update` refreshes plugin code (skills, hooks, MCP server, templates) but never touches a home's scaffolded files (CLAUDE.md, SOUL.md, settings, rules) or runs bun install. This skill reads the CHANGELOG's Upgrade blocks from the home's recorded baseline up to the installed version, backs up, runs bun install when needed, auto-applies functionality-critical changes, and asks before touching anything you may have personalized. Use when the SessionStart banner / dashboard shows "upgrade available" or "enable update tracking", or the user says "upgrade kevin", "apply the update", "I just ran /plugin update".
disable-model-invocation: true
allowed-tools: Bash, Read, Write, Edit, Skill(agent-kevin:sync)
---

# Upgrade — apply pending HOME migrations

`/plugin update` pulls new plugin **code**. It does **not** touch this home's
scaffolded files (`CLAUDE.md`, `SOUL.md`, `IDENTITY.md`, `.claude/settings.json`,
`.claude/rules/`, `knowledge/concepts/`) — those were copied from `templates/`
during `/init` — and it does **not** run `bun install`, so a release that added an
MCP dependency leaves the server unable to start until deps are installed.

This skill closes that gap. The contract is the plugin's `CHANGELOG.md`: each
release carries a machine-actionable `### Upgrade` block. This skill reads them
from the home's recorded baseline up to the installed version and reconciles.

**Bias to safety — this is the operator's whole brain.** Always back up before
writing. Never overwrite a file wholesale. Never delete a section you don't
recognize. Auto-apply only what the producer marked mandatory/additive/deps;
ask before anything optional.

## Step 0 — Resolve paths + versions

```bash
HOME_DIR="${KEVIN_HOME:-$PWD}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
INSTALLED=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$PLUGIN_ROOT/.claude-plugin/plugin.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
VERSION_FILE="$HOME_DIR/.kevin/version.json"
if [ -f "$VERSION_FILE" ]; then
  BASELINE=$(grep -o '"templateVersion"[[:space:]]*:[[:space:]]*"[^"]*"' "$VERSION_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
else
  BASELINE=""
fi
echo "installed=$INSTALLED baseline=${BASELINE:-<none>}"
ls "$PLUGIN_ROOT/CHANGELOG.md" >/dev/null 2>&1 || echo "NO CHANGELOG"
```

Confirm `$HOME_DIR` is a real Kevin home (it has `SOUL.md`). If not, stop and tell
the user to run this from their agent home (or set `KEVIN_HOME`).

## Step 1 — Determine what to apply (guards + window)

Read `$PLUGIN_ROOT/CHANGELOG.md`. Each release is a `## [x.y.z] - DATE` heading
with an `### Upgrade` block (format documented at the top of the CHANGELOG).

- **No CHANGELOG / no entries** → the installed plugin predates release tracking.
  Tell the user there's nothing to apply; stop.
- **`BASELINE` present and `BASELINE == INSTALLED`** → "Already up to date (vX)."; stop.
- **`BASELINE` present and `BASELINE` newer than `INSTALLED`** (downgrade / stale code) →
  tell the user to run `/plugin marketplace update <marketplace>` then
  `/plugin update agent-kevin@<marketplace>` and restart, then re-run this. Stop.
- **`BASELINE` present, `< INSTALLED`** → **range mode**: select entries with
  `baseline < version <= installed`.
- **No `version.json`** → **onboard mode** (this home predates update tracking, e.g.
  installed before this feature): select **all** entries with `version <= installed`.
  Every action below is idempotent, so replaying the full history against an
  already-mostly-correct home is safe and self-healing — it converges the home to
  the current templates and stamps a baseline going forward.

If the CHANGELOG's newest version is **below** `INSTALLED` (producer bumped
`plugin.json` but didn't log the release), warn the user and proceed with whatever
entries exist.

## Step 2 — Parse + coalesce the Upgrade actions

From the selected entries, collect every `### Upgrade` action line. Each is:

```
- `<kind>: <severity>` — <note>
```

- **kinds:** `deps` · `settings` · `template/<file>` · `file` · `manual`
- **severity:** `required` · `mandatory` · `optional` · `additive` · `none`

Coalesce across the selected releases (latest wins; the goal is the *current*
template state, not a replay of every intermediate edit):

- **deps** — collapse to a single `bun install` if any release requires it.
- **settings** — union of all named `permissions.allow` / hook / env entries.
- **template/&lt;file&gt;** — dedupe by file; reconcile each file **once** against its
  *current* template. Severity = the strictest seen (mandatory beats optional).
- **file (additive)** — dedupe by path.
- **manual** — collect and surface to the user at the end (these are notes the
  skill cannot automate; never silently skip them).

Build a short plan and show it to the user before touching anything:

```
Upgrade vBASELINE → vINSTALLED (N releases)
  deps:      bun install (new: pg, foo)              [auto]
  settings:  +2 permissions                          [auto]
  files:     +1 new rule (.claude/rules/python.md)   [auto]
  CLAUDE.md: 1 new section "Upgrades"                 [auto, mandatory]
  SOUL.md:   1 changed section "Writing Style"        [ask]
```

## Step 3 — Back up first

Snapshot every HOME file the plan will touch, before any write:

```bash
TS=$(date +%Y%m%d-%H%M%S)
BACKUP="$HOME_DIR/.kevin/updates/${BASELINE:-init}-to-${INSTALLED}-${TS}"
mkdir -p "$BACKUP"
# for each file in the plan that exists:
#   mkdir -p "$BACKUP/$(dirname REL)"; cp "$HOME_DIR/REL" "$BACKUP/REL"
```

Tell the user the backup path. If anything looks wrong afterward, they restore from there.

## Step 4 — Execute (auto for mandatory/additive/deps; ask for optional)

**deps** — install in the plugin's MCP server (also do this unconditionally if
`$PLUGIN_ROOT/mcp-server/node_modules` is missing, regardless of flags):

```bash
( cd "$PLUGIN_ROOT/mcp-server" && bun install )
```

**settings (mandatory)** — merge the named entries into
`$HOME_DIR/.claude/settings.json`. Read it, add only entries **not already present**
(union + dedupe `permissions.allow`; never reorder or remove existing entries; never
touch operator keys like `hooks`/`theme`/`env` unless an action names them). Write back
valid JSON. Idempotent: re-running adds nothing.

**file (additive)** — copy the template to its HOME destination **only if absent**:

```bash
# e.g. cp "$PLUGIN_ROOT/templates/rules/python.md" "$HOME_DIR/.claude/rules/python.md"
```

Never overwrite an existing file in this step (additive = new files only).

**template/&lt;file&gt; — section-aware merge.** Map template → HOME destination:

| Template | HOME destination |
|---|---|
| `templates/CLAUDE.md` | `CLAUDE.md` (or `CLAUDE.local.md` if that's what `/init` wrote) |
| `templates/SOUL.md` | `SOUL.md` |
| `templates/IDENTITY.md` | `IDENTITY.md` |
| `templates/rules/<x>.md` | `.claude/rules/<x>.md` |
| `templates/knowledge/concepts/<x>.md` | `knowledge/concepts/<x>.md` |

`USER.md` and `knowledge/user/*` are pure operator data — **never** reconciled here.

Merge algorithm (per file):

1. Read the current template (T) and the home file (H).
2. Split each into a preamble (text before the first `##`) + sections keyed by their
   `##` heading text.
3. Resolve any `{{TOKENS}}` in T the same way the existing H resolved them (e.g.
   `{{KNOWLEDGE_REL}}`, `{{PROJECTS_REL}}`, `{{PLATFORM}}`, `{{SHELL}}` — read the
   values straight from H's corresponding lines). If a token can't be resolved with
   confidence, leave that line as-is in H and flag it for the user.
4. For each section in T:
   - **Not in H** → NEW. Mandatory: add it (placed after its template-neighbor, else
     appended). Optional: show it and ask.
   - **In H, content differs** → CHANGED. Mandatory: replace H's section with T's,
     show the diff in the summary. Optional: show the diff and ask y/n.
   - **Identical** → skip.
5. **Sections in H but not in T are operator additions** (e.g. a personal
   "Sibling Agent" block, extra "Operational Rules"). **Preserve them verbatim,
   in place. Never delete or reorder them.**
6. Reassemble preserving H's section order; updated sections change in place, genuinely
   new template sections append.

Show each merge as a unified diff before writing. Mandatory merges apply
automatically (with the diff in the summary); optional merges wait for y/n.

**manual** — print each manual note for the user to handle by hand; do not stamp the
baseline past a release with an unaddressed manual step unless the user confirms.

## Step 5 — Stamp the new baseline

Rewrite `$HOME_DIR/.kevin/version.json`: set `templateVersion` to `$INSTALLED`,
preserve `initializedAt` (on the onboard path there's none — set it to today),
set `lastUpgrade` to now (ISO-8601 with tz offset), and append a history entry
`{ "from": "<baseline-or-null>", "to": "<installed>", "at": "<now>" }`.

```bash
date +%Y-%m-%dT%H:%M:%S%z   # use for lastUpgrade / history.at
```

(Write the JSON with the Write tool, preserving any existing `initializedAt` and
prior `history` entries.)

**Ensure the baseline is git-trackable (built-in invariant, every run).** Homes
scaffolded before this feature ignore all of `.kevin/` except `knowledge.json`, so a
freshly written `version.json` would be gitignored and lost on the next clone/restore
— silently resetting upgrade tracking. Un-ignore it. Idempotent; the negation must
follow the `.kevin/*` line (git can't re-include a file whose parent dir is ignored):

```bash
GI="$HOME_DIR/.gitignore"
if [ -f "$GI" ] && grep -qxF ".kevin/*" "$GI"; then
  grep -qxF "!.kevin/version.json" "$GI" || printf '!.kevin/version.json\n' >> "$GI"
fi
```

(If `.gitignore` is absent or doesn't ignore `.kevin/*`, `version.json` is already
trackable — nothing to do.)

## Step 6 — Report

One concise summary:

- version moved `vBASELINE → vINSTALLED`
- applied: deps / settings / files / mandatory merges (list them)
- asked: optional merges and what the user chose
- skipped: anything already current
- backup path
- any `manual:` notes still needing the operator's hand

## Step 7 — Settle with a sync

The upgrade may have changed settings, rules, or pulled new skills/tools; a sync
recompiles knowledge, refreshes the dashboard (clearing the "upgrade available"
badge now that the baseline is stamped), and regenerates the briefing against the
new state. So the last step is a full sync.

**Ordering matters when deps or MCP-server code changed:** the running MCP server
still holds the OLD code until Claude Code reloads, so a sync now would run against
the stale server. Therefore:

- **If `bun install` ran this session, or the update pulled new MCP-server code** →
  do NOT sync yet. Tell the user to **restart / reload Claude Code first**, then run
  `/agent-kevin:sync`. (End the skill here with that instruction.)
- **Otherwise** (HOME-only changes — settings, rules, templates) → invoke the `sync`
  skill now via the Skill tool as the final step.

## Notes

- **Idempotent.** Re-running with no new releases is a no-op ("already up to date").
  Every action skips work already done.
- **The home's git is the operator's, not yours.** Don't commit the home — surface
  the backup path and let them review/commit (homes are often local-only).
- **Source of truth for content is the current `templates/`.** The CHANGELOG tags only
  say which files changed and how aggressively to apply; never invent content not in a
  template.
- First run on a pre-feature home (onboard mode) is the real onboarding path every
  existing user takes — there are no shortcuts and nothing is hand-seeded.
