# mermaid skill

Gate that keeps broken Mermaid diagrams out of files. Model-invocable: fires when authoring or editing a ```mermaid block in a plan, spec, report, task, or knowledge file, and on `/mermaid`.

## Why

A Mermaid diagram that parses in the author's head but throws when the reader opens the file has shipped before. Relying on remembering to check does not scale. This skill makes the check part of authoring.

## Two tiers

| Tier | What | Cost | When |
|---|---|---|---|
| 1 | `mermaid.parse()` every block, headless | cheap, no browser | always, before review |
| 2 | render + read the image back + critique | heavy (chromium) | diagrams headed to a surface where the look matters |

Tier 1 proves it renders. Tier 2 proves it looks right (dark-theme legibility, layout, clipped labels). Rendering without reading the image back into context is pointless: the pixels have to reach the model for it to iterate.

## Files

- `SKILL.md`: the procedure (trigger, Tier 1, Tier 2, boundaries).
- `references.md`: diagram-type selection, authoring rules, and parse/render failure modes with fixes.
- `scripts/validate.ts`: the Tier 1 validator. Extracts ```mermaid blocks from files, parses each, exits non-zero on any failure.

## Validator, run directly

```bash
NODE_PATH="${CLAUDE_PLUGIN_ROOT}/mcp-server/node_modules" \
  bun run "${CLAUDE_PLUGIN_ROOT}/skills/mermaid/scripts/validate.ts" <file...>
```

Deps (`mermaid`, `jsdom`) are vendored in `mcp-server/node_modules`. No network at runtime. The `mermaid` dependency is pinned in `mcp-server/package.json`; the server itself never imports it, so it is disk cost only, not runtime weight.

## Not a hook

Validation is not wired as a `PreToolUse`/`Stop` hook. That was considered and rejected as too invasive for an occasional, self-correcting-in-chat need: a hook on every file write, able to block unrelated work if the validator hiccups, is disproportionate. The skill's own procedure bakes validation into authoring instead. A future `knowledge_lint` backstop can call `validate.ts` as a subprocess to catch anything that reaches a `knowledge/` file unvalidated.
