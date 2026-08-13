---
name: rename-agent
description: Rename this agent's display name across an existing HOME — IDENTITY.md fields, avatar, and every prose mention in SOUL/CLAUDE/USER, knowledge, and projects — without forking the plugin or touching the `/agent-kevin:` namespace. Also the repair path when a half-finished rename left mixed names behind. Only runs when explicitly invoked via /rename-agent, and is deliberately left ungranted so it asks for permission every time.
disable-model-invocation: true
---

# Rename Agent

Change what this agent calls itself. The display name is data in `IDENTITY.md`; the
namespace is code in the plugin manifest. This skill moves the first and never the
second.

**Slash-only, and unpermissioned on purpose.** It rewrites files across the whole brain
in one pass, so it never fires on its own — not from a passing "maybe call it something
else", not via the Skill tool from another skill. It is also deliberately absent from the
`permissions.allow` grants `init` writes, so even `/rename-agent` raises a confirm prompt.
Two gates, both intentional: don't "fix" either by adding a grant.

## What changes and what doesn't

| Changes | Stays |
|---|---|
| `IDENTITY.md` → `Name`, `Emoji`, `Avatar` | `/agent-kevin:*` slash commands |
| The avatar image file | `mcp__plugin_agent-kevin_kevin__*` tool names |
| Prose in `SOUL.md`, `CLAUDE.md`, `USER.md` | `KEVIN_*` / `AGENT_*` env vars |
| Prose in `knowledge/`, `projects/`, reports | `.kevin/` runtime dir |
| | `enabledPlugins` in `.claude/settings.json` |

The right-hand column is plumbing. None of it surfaces in conversation, and changing
any of it means forking the plugin and giving up clean updates. Say this out loud if
the operator asks why their slash commands still say `agent-kevin`.

## Step 1 — Establish both names

The current name is `IDENTITY.md`'s `- **Name:**` field. That is the canonical source
(the dashboard reads exactly this line), so read it rather than assuming "Kevin":

```bash
grep -m1 '^- \*\*Name:\*\*' "$HOME_DIR/IDENTITY.md"
```

If the file has no `Name` field, the home predates it: fall back to `Kevin` and note
that Step 3 will add the field. If the field holds a literal `{{AGENT_NAME}}`, an init
run failed to substitute it — say so, treat `Kevin` as the old name for the sweep, and
let Step 3 write the real one.

Ask for the new name with `AskUserQuestion` if the operator didn't already give one.
**It must match `^[A-Za-z0-9][A-Za-z0-9 -]*$`** — same allowlist `/agent-kevin:init`
enforces, for the same reason: the value is rendered inside markdown link syntax and
read back out by the dashboard's line parser. Offer the closest clean form rather than
accepting anything else.

Refuse the no-op: if old and new match, say so and stop.

## Step 2 — Show the blast radius before touching anything

Count first, edit second. The operator should see the scale before approving:

```bash
cd "$HOME_DIR"
rg -P '(?<![/\\])\bKevin\b(?![/\\])' --glob '!knowledge/raw/sessions/**' -c --no-filename | wc -l
rg -P '(?<![/\\])\bKevin\b(?![/\\])' --glob '!knowledge/raw/sessions/**' -l | head -40
```

(Substitute the actual current name for `Kevin`.)

**Three exclusions, each load-bearing.**

- **`knowledge/raw/sessions/`** — captured historical transcripts, an append-only record
  of what was actually said. Rewriting them fabricates history, costs a large diff, and
  buys nothing. If the operator insists, say why not once, then do as they ask.
- **Anything under a dot-directory** — `.git/`, `.kevin/`, `.claude/`, `.mcp.json`.
  ripgrep skips hidden paths by default, so this is free, and **you must not pass
  `--hidden` to get around it.** `.kevin/` is runtime state (compile cursor, logs,
  config) and `.claude/settings*.json` plus `.mcp.json` are harness config holding
  absolute paths and permission rules. A stray edit there breaks the session rather
  than mislabeling a document.
- **Path segments** — see the lookarounds in the pattern below.

**The home directory is not renamed and must not be.** By convention it's
`~/Documents/Agents/Kevin`, so the old name is embedded in absolute paths all over the
brain: `settings.local.json` env values, `.mcp.json`, and prose lines like
``Agent home at `~/Documents/Agents/Kevin/` ``. Rewriting those points every path at a
directory that doesn't exist. The regex below refuses to touch `Kevin` when it sits
directly against a `/` or `\`, which is what makes the sweep safe to run on a home named
after the agent. If the operator also wants the folder moved, that's a separate manual
job (move it, then repoint `AGENT_CODE_PATH`/`AGENT_REPORTS`/`.mcp.json` and any
separated git dir) — offer it, don't fold it in here.

## Step 3 — IDENTITY.md, the load-bearing edit

Everything the dashboard renders comes from four lines here (`Name`, `Kind`, `Vibe` or
`Register`, `Emoji`), plus the first markdown image in the file as the avatar. Use
`Edit`, not the sweep, so these are exact:

- `- **Name:** <new>`
- `- **Emoji:** <new>` if they want a different one
- The `![...](path)` image line and the `- **Avatar:**` line

Avatar handling:

- **Keeping the old image** — fine, but if the filename carries the old name
  (`kevin-avatar.jpg`), `git mv` it to match the new one and repoint both lines.
- **New image** — copy it to `.claude/assets/<newname-lowercased>-avatar.<ext>`,
  repoint both lines, delete the old file.
- **None** — delete the image line and the `- **Avatar:**` line outright. Do not leave
  an empty link; the dashboard takes the first image in the file and a dangling one
  renders broken.

## Step 4 — Sweep the prose

Case-sensitive, word-boundary, and path-guarded.

```bash
cd "$HOME_DIR"
rg -P '(?<![/\\])\bKevin\b(?![/\\])' --glob '!knowledge/raw/sessions/**' -l \
  | while IFS= read -r file; do
      perl -pi -e 's{(?<![/\\])\bKevin\b(?![/\\])}{Vikrum}g' "$file"
    done
```

Three properties do the work, and all three are required:

- **Exact case.** Every plumbing token is lowercase (`agent-kevin`, `.kevin`,
  `kevin-avatar`, `bin/kevin`) or uppercase (`KEVIN_HOME`), so `Kevin` cannot reach
  them. **Never add `-i`.**
- **`\b` word boundary.** Catches `Kevin's` (the boundary sits before the apostrophe)
  without matching inside a longer word.
- **The `/` and `\` lookarounds.** These are what stop the sweep from rewriting the home
  path. Without them, ``~/Documents/Agents/Kevin/`` becomes
  ``~/Documents/Agents/Vikrum/`` and every documented path in the brain points nowhere.
  Both sides are needed: the home appears with a trailing slash, without one at end of
  line, and backslash-separated on Windows.

**Use `perl`, not `sed`.** BSD `sed` on macOS does not support `\b`, and
`sed -i '' 's/\bKevin\b/.../'` silently matches nothing — it exits 0 and changes zero
files, which reads exactly like success. `perl -pi -e` behaves identically on macOS and
Linux.

**Use the `while read` loop, not `xargs`.** It does the right thing on zero matches
(the loop body never runs, where bare `xargs` on GNU would invoke `perl` with no file
arguments and hang reading stdin) and on paths containing spaces, which agent homes
under `~/Documents/Agents/<Name>` can easily have.

Possessives (`Kevin's`) are handled: `\b` sits before the apostrophe.

Then verify. Two checks, and the second one matters more:

```bash
# 1. Nothing renameable left (path hits are expected and correct).
rg -P '(?<![/\\])\bKevin\b(?![/\\])' --glob '!knowledge/raw/sessions/**' || echo "clean"

# 2. Home paths survived intact — this must still return hits, not zero.
rg -n 'Agents/Kevin|agent-kevin|\.kevin/|KEVIN_' --glob '!knowledge/raw/sessions/**' | head -20
```

If check 2 comes back empty on a home that had path references before the sweep,
something rewrote the paths: stop and restore from git rather than continuing.

## Step 5 — Review, then hand back

Show `git diff --stat` (or the file list when the home isn't a git repo) and call out
anything the sweep touched that looks like it shouldn't have changed. Names embedded in
prose about *other* things (a person called Kevin, a quoted upstream doc) are the one
real false-positive class. Scan for them rather than trusting the count.

Do not commit. The HOME is the operator's, and some homes have a separated git dir the
agent can't write to anyway. Print what changed and let them commit.

Close with what did NOT change and why, in two lines: the slash commands, tool names,
env prefix and `.kevin/` dir still say kevin because they come from the plugin
manifest, and that's what keeps `/plugin update` working. Nobody sees them but you.

## Notes

- **Future upgrades respect this.** `/agent-kevin:upgrade` resolves `{{AGENT_NAME}}` in
  the shipped templates from this home's `IDENTITY.md` before diffing, so template
  changes arrive phrased in the new name and never propose reverting it. That is why
  Step 3 must land even if the operator only cares about the prose.
- **Multiple homes from one plugin** are a supported setup (a work agent and a personal
  one, same `agent-kevin` install). They stay isolated by location, not by name, so
  renaming one has no effect on the other. Two same-plugin homes must not set
  `KEVIN_HOME` machine-wide, since one value would capture both.
- **This is not a fork.** If the operator actually wants their own slash-command
  namespace and env prefix, that's a plugin fork: change `name` in
  `.claude-plugin/plugin.json` and the prefix follows automatically. Tell them the cost
  honestly — a merge from upstream on every release, forever — before they choose it.
