---
name: rename-agent
description: Rename this agent's display name across an existing HOME — the Name in IDENTITY.md, the emoji and avatar, and every mention in the markdown the agent reads now (SOUL, AGENTS, USER, the .claude/CLAUDE.md bridge, rules, knowledge, projects), with the old name recorded so history still makes sense. Never renames the home folder, the plugin namespace or dated records. Also the repair path when a half-finished rename left mixed names behind. Only runs when explicitly invoked via /rename-agent, and is deliberately left ungranted so it asks for permission every time.
disable-model-invocation: true
---

> Operator-invoked only. Run this when the operator named this skill, or when a skill the operator invoked calls for it as a documented step; otherwise stop and ask before doing anything. Claude Code enforces this through the frontmatter above, Codex through `agents/openai.yaml`; this line is the backstop for any host that reads neither.

# Rename Agent

Change what this agent calls itself. The display name is data in `IDENTITY.md`; the
namespace is code in the plugin manifest. This skill moves the first and never the
second.

> **The home folder keeps its name.** A home at `~/Documents/Agents/Kevin` stays there:
> session history, the brain's version history and the home's settings are all keyed to
> that path, and moving it is a separate manual job this skill never does. Tell the
> operator this before Step 2.

**Slash-only, and unpermissioned on purpose.** It rewrites files across the whole brain
in one pass, so it never fires on its own — not from a passing "maybe call it something
else", not via the Skill tool from another skill. It is also deliberately absent from the
`permissions.allow` grants `init` writes, so even `/rename-agent` raises a confirm prompt.
Two gates, both intentional: don't "fix" either by adding a grant.

## What changes and what doesn't

| Changes | Stays |
|---|---|
| `IDENTITY.md` → `Name` (old name added to `Formerly`), `Emoji`, avatar | The home folder and every path that contains it |
| Markdown in `SOUL.md`, `AGENTS.md`, `USER.md`, `.claude/CLAUDE.md`, `.claude/rules/` | Dated records: `reports/`, `knowledge/raw/` (sessions, feedback, inbox), and every `archive/` folder |
| Markdown in `knowledge/` and `projects/` | Anything that isn't markdown: code, HTML (a roadmap, an issued letter), JSON |
| `projects/TASKS.md` and `dashboard.html`, regenerated | Custom skills in `.claude/skills/`: listed for the operator, never written |
| | `/agent-kevin:*` slash commands and `mcp__plugin_agent-kevin_kevin__*` tool names |

Dated records keep the name they were written under. The `- **Formerly:**` line in
`IDENTITY.md`, loaded every session and read by the compile prompts, is what tells the
agent that the old name in them means itself.

The slash commands and tool names are plumbing from the plugin manifest; changing them
means forking the plugin and giving up clean updates. Say so if the operator asks why
their slash commands still say `agent-kevin`.

## How the rename decides

`scripts/rename-agent.ts` does all the reading and writing with the rule seed export
uses (`renameAgent` in `mcp-server/src/shared/agent-name.ts`): exact case, whole word, and
never a name touching a letter, digit, `-`, `/` or `\`. So `Kevin's`, `_Kevin_` and `Kevin.`
rename, while `~/Documents/Agents/Kevin/`, `Documents-Agents-Kevin.git`, `X-Kevin-Test` and a
mention already inside the new name (`Kevin Prime`) stay. It reads only `.md` files, skips
hidden folders other than the bridge and rules, any file that isn't clean UTF-8 (a rewrite
would mangle it), and every symlink, so a file shared beyond this home is never written
through; a symlinked `IDENTITY.md` stops the run. Don't reproduce it with `sed`, `perl` or `rg`.

```bash
HOME_DIR="${AGENT_HOME:-$PWD}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-<SKILL_BASE_DIR>/../..}"   # Claude Code fills the variable in; under Codex replace <SKILL_BASE_DIR> with this skill's base directory (the <skill> block's <path>) before running
RENAME="$PLUGIN_ROOT/skills/rename-agent/scripts/rename-agent.ts"
```

## Step 1 — Establish both names

The old name is `IDENTITY.md`'s `- **Name:**` field; the script reads it. Ask for the new
name with `AskUserQuestion` if the operator didn't give one. **It must match
`^[A-Za-z0-9][A-Za-z0-9 -]*$`**, init's allowlist (the name sits inside markdown link
text and line parsers read it back), and the script refuses anything else. Offer the
closest clean form.

Pass `--from <old name>` only to repair: when `IDENTITY.md` already shows the new name
(a half-finished rename), when it holds a literal `{{AGENT_NAME}}`, or when the prose
uses a different old name than the field. Without it, a Name equal to the new one stops
the run and says so.

## Step 2 — Dry run, then review every line

```bash
DRY=$(mktemp "${TMPDIR:-/tmp}/rename-dry-XXXXXX")
bun "$RENAME" --home "$HOME_DIR" --to "<New>" > "$DRY"
```

It writes nothing. The JSON in `$DRY` can run to hundreds of KB on a lived-in home, so read
it in parts until you've seen all of it:

- `hits`: every line it would change (`path`, `line`, and the whole line as `text`; every
  mention on it is renamed), with `totals`.
- `identity`: the Name change and the `Formerly` list it will write. Those two lines of
  `IDENTITY.md` are never hits and can't be kept.
- `guarded`: lines where the old name sits in a path or identifier and stays.
- `manual`: hits in custom skills, which the operator edits by hand.

Read every `hits` line, not the count. The one false-positive class is the old name
meaning something other than this agent: a person, a character the agent was named
after ("Inspired by the minion Kevin"), a product or repo that shares the name, a quoted
upstream doc. Show the operator the totals and each line you'd keep as-is, and agree on
the keep list before writing. A keep covers the whole line: when one line names both this
agent and someone else, keep it and fix the agent's mention with `Edit` after Step 3.

## Step 3 — Apply

```bash
bun "$RENAME" --home "$HOME_DIR" --to "<New>" --keep "<path>:<line>" --keep "<path>:<line>" --apply
```

Keep line numbers come from the dry run. A `--keep` that matches no renameable line stops
the run before anything is written: rerun the dry run and copy the numbers again.

`--apply` writes exactly what the dry run showed: the hit lines, plus the `identity` edit
(the new `- **Name:**`, and the old name added to `- **Formerly:**`, created under the Name
line; a name renamed back to comes off the list). An `IDENTITY.md` that isn't UTF-8 stops
the run before any write. It prints the dry-run report plus `changed`, the files it wrote.

Running the same command again stops at "already says <New>". A `--from` rerun finishes a
half-done rename, but it has no memory of the first run's keeps, so treat it as a new
rename: run its dry run, review it, and pass the keeps again. Line numbers below the Name
in `IDENTITY.md` move down by one once `Formerly` is added.

## Step 4 — Emoji and avatar

Edit these in `IDENTITY.md` with `Edit`, not the script. The dashboard takes its persona
header from the `Name`, `Kind`, `Vibe` (or `Register`) and `Emoji` fields and the first
image in the file; the session banner shows the `Name`, the status line and `/today` the `Emoji`.

- `- **Emoji:** <new>` if they want a different one.
- **Keeping the old image:** if its filename carries the old name (`kevin-avatar.jpg`),
  rename the file with plain `mv` (never `git mv`, which stages in the operator's repo) to
  `assets/<newname-lowercased>-avatar.<ext>` and repoint both the `![...](path)`
  line and the `- **Avatar:**` line.
- **New image:** copy it to `assets/<newname-lowercased>-avatar.<ext>`, repoint
  both lines, and delete the old file only once the new one is in place.
- **None:** delete the image line and the `- **Avatar:**` line outright; an empty link
  renders broken.

## Step 5 — Regenerate, review, hand back

Run the `dashboard` MCP tool: it regenerates `dashboard.html` and `projects/TASKS.md` from
current state, so neither is hand-edited.

Show `git -C "$HOME_DIR" diff --stat` (or the `changed` list when the home isn't a git
repo). Do not commit: the home is the operator's, and some homes keep their git dir where
the agent can't write. Then hand back, in a few lines:

- the counts, and the lines kept as-is;
- any `manual` hits in custom skills, for the operator to edit;
- that the folder, the dated records and the slash commands kept the old name, and why
  (the paths would break, history stays as written, `/plugin update` needs the namespace);
- that the new name shows in the session banner from the next session.

## Notes

- **Future upgrades respect this.** `/agent-kevin:upgrade` resolves `{{AGENT_NAME}}` in
  the shipped templates from this home's `IDENTITY.md` before diffing, so template
  changes arrive phrased in the new name and never propose reverting it.
- **Multiple homes from one plugin** are a supported setup (a work agent and a personal
  one, same `agent-kevin` install). They stay isolated by location, not by name, so
  renaming one has no effect on the other.
- **This is not a fork.** If the operator actually wants their own slash-command
  namespace, that's a plugin fork: change `name` in
  `.claude-plugin/plugin.json` and the namespace follows automatically. Tell them the cost
  honestly — a merge from upstream on every release, forever — before they choose it.
