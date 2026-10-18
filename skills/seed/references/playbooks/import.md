# Import — inherit a teammate's agent setup (`/seed import <path>`)

Overlay a seed bundle onto this home. Prerequisite: this home is already initialized
(`/agent-kevin:init` ran here) — the tool refuses otherwise. The bundle's files become
this operator's own; nothing stays linked to the source agent.

## Step 1 — Locate the bundle

Resolve the zip path from the operator's message (`~` expands; confirm the file exists
with `test -f`). If they only said "import the seed", ask where the file landed.

## Step 2 — Dry run, then review

Call `seed_import` with `dryRun: true` and present the plan grouped:

- **Who it's for** — the result's `audience`, which is the sender's claim, not a fact. On
  `self`, ask the operator whether they exported this bundle themselves; once they confirm,
  personal rules in IDENTITY.md and SOUL.md (an address rule, faith, family) are theirs and
  expected, never a leak. `teammate`, an unconfirmed `self`, or a bundle without the field means
  another person's persona: point out anything personal to its sender.
- **Files to write** — by category (identity / knowledge / projects / skills / rules / browser
  flows / scripts / surfaces). Show each browser flow's `index.ts` in full: the `browser_flows` tool runs it
  outside the sandbox. Show each other script under `scripts/` in full too: it is code the operator will run.
- **AGENTS.md overlay section** — appended to this home's scaffolded manual (never a
  replacement); re-importing the same bundle is skipped when the section is already there
- **Conflicts** — existing files that differ from the bundle. For a fresh-after-init home
  the expected conflicts are IDENTITY.md and SOUL.md (init scaffolded them; the seed
  replaces them — that's the point of inheriting the persona). Anything else diverging
  deserves a real look before overwriting.
- **Setup merges** — permission entries to add, MCP servers to register (existing names
  are never clobbered), env placeholders to plant
- **Credentials** — the secret key NAMES the operator will fill afterward

Then ask this question on its own, in a call with no other question, with all three options:

> **Apply the seed?**
> - Apply, overwrite the <n> conflicting file(s) — inherit the persona fully
> - Apply without overwriting — keep my existing versions, add everything else
> - Cancel

If the call fails, ask the same question in plain text and wait for the answer. Never pick
an option yourself: the operator's answer is the only thing that applies a seed.

## Step 3 — Apply

Re-run `seed_import` with the chosen `overwrite`. If the result lists `ask` entries under
`permissionsAdded` and this home is wired for Codex (`test -f <HOME>/.codex/hooks.json`),
call `codex_setup` next: the Codex rules file is generated from that ask list, so without
the rerun those commands run unprompted under Codex. Report what landed, then close with the
operator's checklist.

Apply the imported files as they came: don't rewrite IDENTITY.md or SOUL.md afterwards on
your own judgment (dropping a rule, changing the role, swapping the avatar). Suggest the
edit and make it only on a yes.

The checklist:

```
✅ Seed applied — this agent is now <agentName>.

Left for you (values never go through chat):
1. Fill these in <HOME>/.state/secrets/.env via your editor: <secretKeysToFill>
2. Fill these in <HOME>/.claude/settings.local.json env: <settingsEnvPlanted>
3. Restart Claude Code (and any Codex session from this home) so the new MCP servers,
   permissions, and identity load.
```

If the bundle seeded a roadmap draft (`knowledge/concepts/roadmap-draft.md`), offer to
render it now: the roadmap skill takes the draft's when/milestone table as its interview
input and produces the north-star surface at `roadmap.html`.

Notes to surface when relevant:
- The display name comes from the imported IDENTITY.md. The plugin namespace
  (`/agent-kevin:*` commands, MCP tool names) is unchanged; only a plugin fork renames
  it, and a second home on the same machine doesn't need one.
- Third-party skills.sh libraries don't travel in bundles; if the source agent used any,
  install them with `/agent-kevin:configure-skills` (Section F).
- Re-importing the same bundle is a no-op: unchanged files are skipped, merges dedupe,
  and the AGENTS.md overlay section is skipped when it is already in the manual.
