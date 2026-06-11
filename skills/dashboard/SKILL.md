---
name: dashboard
description: Rebuild and open the Agent OS dashboard — a static HTML mission-control page covering today's plan and activity, work across projects, sessions, Kevin's brain, reports, capabilities, and system internals. Also refreshes the projects/TASKS.md task dashboard in the same pass. Use when the user wants the big picture of what Kevin is and what's going on.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__dashboard, Bash
---

# Dashboard

The Agent OS dashboard is the command center: a self-contained `index.html` at
the agent home, regenerated from current state on demand. No server, zero
external requests.

## Run

1. Rebuild the snapshot (one call refreshes both `index.html` and
   `projects/TASKS.md` — the two derived views always regenerate together):

```
mcp__plugin_agent-kevin_kevin__dashboard
```

Returns `{ path, bytes, tasks }`.

2. Open it for the user (macOS):

```bash
open "<path from step 1>"
```

3. Reply with one line: the dashboard is open, plus anything the health badge
   would flag (the tool result alone doesn't carry health — skip unless asked).

## Pages

`today` (plan + today-so-far activity) · `work` (agenda / projects / needs
attention) · `sessions` · `brain` (threads / concepts / memory / pipeline) ·
`reports` · `capabilities` (cheatsheet / skills / tools / reflexes) ·
`persona` · `system` (context / settings / logs). Sub-tabs deep-link:
`index.html#work/projects`.

## Notes

- Pure read: regenerating the dashboard never mutates knowledge or task files
  (`projects/TASKS.md` is a derived view, rebuilt from frontmatter).
- Secrets are redacted at the source (`••••`); never un-redact them.
- Markdown links open via the configured opener app: set the `MARKDOWN_URL`
  env var in `.claude/settings.local.json` (`{path}` placeholder, e.g.
  `markedit://open?path={path}`); defaults to
  `obsidian://open?path={path}&paneType=tab` (new Obsidian tab, dashboard stays put).
- Every `/agent-kevin:sync` also refreshes the dashboard; `kevin status` does
  the same from a terminal.
