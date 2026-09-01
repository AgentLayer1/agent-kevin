---
name: seed-export
description: Export a seed bundle — a zip a teammate imports into their own fresh agent home to inherit this agent's persona and setup (name, SOUL, curated operating-manual sections, selected knowledge concepts, project READMEs/roadmaps, custom skills, MCP server registrations, pack activations) while starting from a clean slate on everything personal. Use when the operator says "export the agent for <teammate>", "make a seed/handoff bundle", "get my team on this agent", or /agent-kevin:seed-export. Two stages, both mandatory — an interview that builds the manifest, then a per-file review gate before anything is zipped. One-shot fork semantics; for ongoing knowledge sync between agents this is the wrong tool.
allowed-tools: mcp__plugin_agent-kevin_kevin__seed_scan, mcp__plugin_agent-kevin_kevin__seed_export, AskUserQuestion, Read, Bash(ls *), Bash(cat *), Bash(grep *)
---

# seed-export — hand this agent to a teammate

Build a seed bundle: a plain zip the recipient imports after their own `/agent-kevin:init`
(`/agent-kevin:seed-import`). Fork semantics — everything in the bundle becomes the
recipient's own, freely editable. Nothing leaves this machine without the operator
approving the exact contents.

**Never in a bundle, no exceptions:** secret values, `.kevin/` state, USER.md,
`knowledge/{user,memory,raw}`, tasks, session transcripts, the scaffolded CLAUDE.md
(curated sections travel as a CLAUDE.md overlay section instead), machine-specific paths.
The `seed_export` tool enforces the structural excludes; this skill enforces judgment —
client names, personal context, and operator-specific material must be caught in review.

## Step 0 — Scan

Call `seed_scan`. It returns everything the interview needs: agent name (vs template),
identity divergence, concepts (template-identical ones flagged — the recipient's own init
seeds those), projects with README/roadmap, custom skills (symlinked skills.sh installs
listed separately — they are NOT exportable; the recipient reinstalls from the registry),
rules, HOME `.mcp.json` servers with the env key names they reference, active packs,
classified permission entries, and settings.local.json env key names.

## Stage 1 — Interview (builds the manifest)

Every question shows what the scan detected. Run the rounds via `AskUserQuestion`:

### 1. Scope

> **What are you exporting?**
> - Whole agent — persona + all shareable knowledge and setup
> - A project slice — one or more projects with their associated knowledge and tooling
> - Identity only — name, soul, avatar; nothing else

For a **project slice**: `Read` the chosen `projects/<slug>/README.md` (and roadmap if
present), follow its `[[concepts/...]]` wikilinks into `knowledge/concepts/`, and present
that concept set pre-ticked; the operator adds/removes. Also pre-tick the custom skills
and MCP servers plausibly tied to the project (name/content match — e.g. an `acme-logs`
skill for the acme project); the operator confirms.

### 2. Identity

If the scan shows a custom name (differs from the template's), lead with it:

> **Carry the identity?** Detected name: **<name>**, avatar: <files>, SOUL.md <diverged / stock>.
> - Name + avatar + SOUL (the full persona)
> - Name + avatar only (recipient keeps stock SOUL)
> - Skip — recipient names their own agent at init

### 3. Knowledge + surfaces

Multi-select from the scan: concepts (template-identical ones default-unticked, marked
"comes with init"), project READMEs/roadmaps, root `roadmap.html`.

### 4. Local setup beyond the scaffold

Present each detected item by name, per-item tick:
- **Custom skills** (`.claude/skills/<name>`) — whole directories
- **MCP servers** from `.mcp.json` — show each server's referenced env key names and say
  the recipient gets the entry + empty key placeholders, never values
- **Diverged/custom rules** (template-identical ones default-unticked)
- **Active packs** — carried as their permission grants + the key names the recipient
  must fill (the scan lists each pack's `secretKeys`/`settingsEnv` — forward the ticked
  packs' names into the export call); recipient's tools work once they add credentials
- **Custom permission entries** (class `custom` in the scan) — walk these individually;
  they can encode personal hosts or paths. Default to excluding anything operator-specific.
- **settings.local.json env keys** — key NAMES only, planted empty on import. Exclude
  machine-specific paths (`AGENT_CODE_PATH`, `AGENT_GIT_REPOS`) unless the operator says
  the team shares the layout.

### 5. Operating-manual overlay (appended to CLAUDE.md)

Never export the manual wholesale — it's init-scaffolded and upgrade-migrated, and it can
hold operator-personal sections. Instead: `Read` the home's CLAUDE.md, compare against the
plugin's `templates/CLAUDE.md`, and draft an overlay containing only the operator-added
sections that make sense for the team (working rules, conventions — not personal context).
Show the draft; the operator edits or drops it. If approved it travels as an `extras`
entry with path `CLAUDE.md` — the import APPENDS it to the recipient's scaffolded manual
(never replaces), and upgrade's template reconciliation carries appended sections forward
like any operator customization. (Never target `CLAUDE.local.md`: in this plugin that is
the manual's alternate location for the init-collision case, and compile reads it with
priority — seeding it would shadow the real manual.)

## Stage 2 — Review gate (confirms the bytes)

The interview decided WHAT; this gate verifies the CONTENT. For each selected file:
show it (or a faithful summary for long files), flag anything that shouldn't travel —
client names that need `acme`-ing, personal paths, private context — and let the operator
**approve / edit / exclude**. Edits happen in the source file or via an `extras` override,
never silently. No approval, no bundle.

Then a final manifest summary (files by category, permission entries, key names, MCP
servers) and one last confirm.

## Step 3 — Export

Call `seed_export` with the approved selection:
- `include` — approved paths (directories like `.claude/skills/<name>` expand)
- `agentName` — from the identity round
- `extras` — the CLAUDE.md overlay section, if approved
- `permissions` / `secretKeys` / `settingsEnv` / `mcpServers` — the approved setup

Report the bundle path and hand the operator the recipient instructions:

```
Seed bundle: <path>

Send it to your teammate along with:
1. Install the agent-kevin plugin (marketplace) and run /agent-kevin:init — when init
   asks "starting from a seed bundle?", point it at this zip and it applies the seed
   automatically after the scaffold. (On an already-initialized home, run
   /agent-kevin:seed-import <bundle path> directly instead.)
2. Review the dry-run plan the import shows before approving.
3. Fill the listed credential keys in <their HOME>/.kevin/secrets/.env via their editor
   (values never travel and never go through chat), then restart Claude Code.
```
