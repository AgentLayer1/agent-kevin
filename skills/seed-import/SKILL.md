---
name: seed-import
description: Import a seed bundle exported from a teammate's agent (via /agent-kevin:seed-export or the AgentLayer website wizard) into THIS home — inheriting the agent's name, SOUL, curated operating-manual overlay, knowledge concepts, project docs, custom skills, MCP registrations, and pack activations, with fork semantics (imported files become this home's own). Use when the operator says "import this seed", "apply the bundle from <teammate>", hands over a *-seed.zip, or /agent-kevin:seed-import <path>. Runs a dry-run plan first and confirms conflicts before writing; ends with the credential checklist the operator fills in their editor.
allowed-tools: mcp__plugin_agent-kevin_kevin__seed_import, AskUserQuestion, Read, Bash(ls *), Bash(test *)
---

# seed-import — inherit a teammate's agent setup

Overlay a seed bundle onto this home. Prerequisite: this home is already initialized
(`/agent-kevin:init` ran here) — the tool refuses otherwise. The bundle's files become
this operator's own; nothing stays linked to the source agent.

## Step 1 — Locate the bundle

Resolve the zip path from the operator's message (`~` expands; confirm the file exists
with `test -f`). If they only said "import the seed", ask where the file landed.

## Step 2 — Dry run, then review

Call `seed_import` with `dryRun: true` and present the plan grouped:

- **Files to write** — by category (identity / knowledge / projects / skills / rules / surfaces)
- **CLAUDE.local.md** — will be appended (or created); note it composes with this home's
  own operating manual and re-importing the same bundle appends again
- **Conflicts** — existing files that differ from the bundle. For a fresh-after-init home
  the expected conflicts are IDENTITY.md and SOUL.md (init scaffolded them; the seed
  replaces them — that's the point of inheriting the persona). Anything else diverging
  deserves a real look before overwriting.
- **Setup merges** — permission entries to add, MCP servers to register (existing names
  are never clobbered), env placeholders to plant
- **Credentials** — the secret key NAMES the operator will fill afterward

Then `AskUserQuestion`:

> **Apply the seed?**
> - Apply, overwrite the <n> conflicting file(s) — inherit the persona fully
> - Apply without overwriting — keep my existing versions, add everything else
> - Cancel

## Step 3 — Apply

Re-run `seed_import` with the chosen `overwrite`. Report what landed, then close with the
operator's checklist:

```
✅ Seed applied — this agent is now <agentName>.

Left for you (values never go through chat):
1. Fill these in <HOME>/.kevin/secrets/.env via your editor: <secretKeysToFill>
2. Fill these in <HOME>/.claude/settings.local.json env: <settingsEnvPlanted>
3. Restart Claude Code so the new MCP servers, permissions, and identity load.
```

Notes to surface when relevant:
- The display name comes from the imported IDENTITY.md. The plugin namespace
  (`/agent-kevin:*` commands, env prefix) is unchanged — renaming that is the separate
  `rename-agent` skill, only needed for a second agent on the same machine.
- Third-party skills.sh libraries don't travel in bundles; if the source agent used any,
  install them with `/agent-kevin:configure-skills` (Section F).
- Re-importing the same bundle is safe: unchanged files are skipped, merges dedupe. The
  one exception is the CLAUDE.local.md overlay, which appends each time.
