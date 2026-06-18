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
   disable-model-invocation: true
   allowed-tools: <comma-separated list of tools the skill needs>
   ---
   ```
2. Write the skill body as a markdown protocol the orchestrating Claude follows.
3. If the skill uses an MCP tool that needs a permission grant, add the tool name to `skills/init/SKILL.md`'s `permissions.allow` list so new installs get it pre-granted.
4. Test by re-running `/reload-plugins` and invoking the skill explicitly.

## Adding an MCP tool

1. Add a file under `mcp-server/src/tools/<your-tool>.ts` exporting a `tools: ToolDef[]` array. Use `defineTool({ name, description, inputSchema, handler })` from `@/shared/types`.
2. Register it in `mcp-server/src/server.ts` by adding an import and spreading the array into the `TOOLS` constant.
3. Add the tool name to `skills/init/SKILL.md`'s `permissions.allow` list (use the `mcp__plugin_agent-kevin_kevin__<tool_name>` prefix).
4. `bun run typecheck` must pass before submitting.

## PR conventions

- Keep changes focused. One concept per PR.
- Update README if you change skill counts, tool counts, or external-facing flows.
- No new dependencies without justification.
- Run `bun run typecheck` and verify the MCP server still boots before opening.

## License

By contributing you agree your work is licensed under [Apache 2.0](./LICENSE).
