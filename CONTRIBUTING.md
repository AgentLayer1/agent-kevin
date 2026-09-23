# Contributing

Pull requests and issues welcome. Below is what we look for and the dev loop.

## Welcome contributions

- **New skill packs** that ship as opt-in via `/agent-kevin:configure-skills`
- **New MCP dispatch tools** for external services (must follow the existing read-mostly + key-gated pattern)
- **Broader platform testing & hardening** — Kevin runs on macOS, Linux, and Windows (native via Git Bash, and WSL2); more real-world testing and platform-specific fixes are welcome
- **Documentation improvements**, more use-case examples, screenshots
- **Translations** and regional-compliance notes

Open an issue before architectural changes — Kevin's contract with `<HOME>/` markdown is intentional and worth preserving.

## Dev setup

```bash
git clone https://github.com/AgentLayer1/agentlayer-claude-marketplace
cd agentlayer-claude-marketplace/agent-kevin/mcp-server
bun install         # installs deps + downloads chromium via the postinstall hook
```

Verify the MCP server boots:

```bash
bun src/server.ts
# expect: "kevin MCP server started — tools=24"
```

Type-check:

```bash
cd mcp-server && bun run typecheck   # runs `tsc`
```

Verify a hook script:

```bash
bun ../scripts/session-start.ts
# expect: JSON with `systemMessage` and `hookSpecificOutput` keys
```

## Local plugin testing

From inside Claude Code:

```text
/plugin marketplace add /absolute/path/to/agentlayer-claude-marketplace
/plugin install agent-kevin@agentlayer
```

After edits, run `/reload-plugins` inside Claude Code to pick up changes without restarting. New skills or hook scripts may require a full `/exit` and relaunch.

## Adding a new skill

1. Create `skills/<your-skill>/SKILL.md` with frontmatter:
   ```yaml
   ---
   name: your-skill
   description: One-line description of what it does and when to invoke it
   allowed-tools: <comma-separated list of tools the skill needs>
   ---
   ```
   Model-invocable is the default: a skill the operator has to remember the slash name for is a skill they won't use. Add `disable-model-invocation: true` (plus the one-line operator-only guard the latent skills carry) when firing it unasked would be expensive or embarrassing — a first-run wizard, a credential walk, a release cut, a whole-brain rewrite, a long interactive interview the operator schedules on a cadence, or **any pack-gated skill**. Being read-only doesn't exempt a skill: every pack skill ships registered to every install, so its description is in the catalog even for operators who never configured the pack, and auto-firing there burns a turn on a missing key, spends metered credit (SerpAPI bills per call), or assumes a stack the operator doesn't run (`wordpress-rest` assumes WordPress). Core skills that need no credential are the ones that should fire on their own.
2. Write the skill body as a markdown protocol the orchestrating Claude follows.
3. If the skill uses an MCP tool that needs a permission grant, add the tool name to `skills/init/SKILL.md`'s `permissions.allow` list so new installs get it pre-granted.
4. **Scratch files get a `mktemp` name, never a hand-picked one.** `$TMPDIR` resolves to `/tmp/claude-<uid>` — it's per-**user**, not per-session, so every Claude Code session running concurrently on the machine shares one directory. A fixed path like `$TMPDIR/prompt.md`, or one keyed only on a run parameter, will be silently overwritten mid-read by another session doing the same thing. Use `mktemp "$TMPDIR/<prefix>-XXXXXX"` (or `mktemp -d` for a directory); both work under the sandbox. No session-id env var is exposed, so there is nothing native to key off instead.
5. Test by re-running `/reload-plugins` and invoking the skill explicitly.

## Adding an MCP tool

1. Add a file under `mcp-server/src/tools/<your-tool>.ts` exporting a `tools: ToolDef[]` array. Use `defineTool({ name, description, inputSchema, handler })` from `@/shared/types`.
2. Register it in `mcp-server/src/server.ts` by adding an import and spreading the array into the `TOOLS` constant.
3. Add the tool name to `skills/init/SKILL.md`'s `permissions.allow` list (use the `mcp__plugin_agent-kevin_kevin__<tool_name>` prefix). Pack-gated tools go in the matching `configure-skills` walk instead of the init baseline.
4. `bun run typecheck` must pass before submitting.

**Tests never touch a real agent home.** `mcp-server/bunfig.toml` preloads `src/test.ts`, which pins `AGENT_HOME` to a fresh throwaway tree for the whole run (and deletes any inherited per-agent override, which would beat it), so a suite that resolves a config path can't write into anyone's brain. A suite needing its own fixture home just sets `AGENT_HOME` (paths and secrets both resolve live, so import order doesn't matter) — save the preload's value and restore it afterwards rather than deleting the variable, or later suites fall back to resolving from cwd.

## Refreshing the demo dashboard

The public demo at agentlayer.one/demo/dashboard is rendered from a fictional home (Acme's agent Ace, operator Alex Chen) that `skills/dashboard/scripts/demo-home.ts` seeds from the real templates, dated relative to now. Rerun it whenever the dashboard or the templates change:

```bash
bun skills/dashboard/scripts/demo-home.ts --out <agentlayer-mono>/apps/agentlayer/public/demo/dashboard.html \
  --avatar <agentlayer-mono>/apps/agentlayer/public/demo/assets/ace-avatar.jpg
```

It renders in isolation (its own `HOME`, environment, and working directory), rewrites every temp and machine path to `/home/alex`, and refuses to write if any real path survives. The docs screenshots are taken from that file with `browser_screenshot` on `file://…/dashboard.html#<page>/<subtab>`.

## PR conventions

- Keep changes focused. One concept per PR.
- Update README if you change skill counts, tool counts, or external-facing flows.
- No new dependencies without justification.
- Run `bun run typecheck` and verify the MCP server still boots before opening.
- **No real names in shipped files.** Skills, templates, hooks, docs, tests, and the CHANGELOG use fictitious placeholders (`acme`, `Ada`), never a real client, employer, operator, or sibling project, and never at write time on the promise of a later sweep.
- **Product docs are host-neutral.** Anything describing agent-kevin (docs, README, wizard copy) names skills bare, says "your host" for the CLI, and puts host-specific commands in per-host tabs, so a new host is a tab and a page, not a rewrite.
- **Frontmatter keys come from the host's docs.** Don't invent keys; `mcp-server/src/skills.test.ts` parses every `SKILL.md`, holds the description to 1,024 characters, and resolves relative links.
- **Invocability is decided per pack,** not per skill in isolation: see *Adding a new skill* above.

## License

By contributing you agree your work is licensed under [Apache 2.0](./LICENSE).
