---
name: seed
description: >
  Hand this agent to a teammate, or take one on. Export builds a seed bundle, a zip another fresh
  agent home imports to inherit this agent's persona and setup (name, SOUL, curated manual, chosen
  concepts, project READMEs, custom skills, MCP servers, packs) while everything personal stays
  behind: an interview builds the manifest, then a per-file review gate runs before anything is
  zipped. Import overlays a bundle onto this home with a dry run first and
  ends with the credential checklist. One-shot fork, not ongoing sync. Triggers on "export the agent
  for <teammate>", "make a seed bundle", "get my team on this agent", "import this seed", "apply the
  bundle from <teammate>", a *-seed.zip handed over, or /seed.
allowed-tools: mcp__plugin_agent-kevin_kevin__seed_scan, mcp__plugin_agent-kevin_kevin__seed_export, mcp__plugin_agent-kevin_kevin__seed_import, mcp__plugin_agent-kevin_kevin__codex_setup, AskUserQuestion, Read, Bash(ls *), Bash(cat *), Bash(grep *), Bash(test *)
---

# Seed

A seed bundle is a plain zip that forks one agent's persona and setup into another home. Everything in it becomes the recipient's own; nothing stays linked to the source.

## Help

`/seed help` (or "what can seed do?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Start

Match the ask to a playbook below, open it, and follow its steps in order; both have gates that are never skipped. A path to a `*-seed.zip` is import. A bare `/seed` replies with [help](references/help.md) and stops.

## Playbooks

| Ask | Playbook |
|---|---|
| "export the agent for <teammate>", "make a seed bundle", "get my team on this agent", `/seed export` | [export](references/playbooks/export.md) |
| "import this seed", "apply the bundle from <teammate>", a `*-seed.zip`, `/seed import <path>` | [import](references/playbooks/import.md) |

## Every time

- **Nothing leaves or lands unreviewed.** Export zips only after the operator approves the exact file list; import writes only after its dry-run plan is confirmed.
- **Export's never-in-a-bundle list has no exceptions,** whatever the operator ticks in the interview.

## Reply

Export ends with the bundle's path and the recipient's one-line instruction; import ends with the credential checklist.
