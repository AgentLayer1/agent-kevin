---
name: dashboard
description: Refresh and open the Agent OS dashboard — a static HTML mission-control page covering today's focus and activity, work across projects, sessions, Kevin's brain, reports, capabilities, and system internals. A refresh snapshots the latest Claude Code sessions (the focus skill's where-am-i radar) and regenerates both dashboard.html and projects/TASKS.md from current state, without the heavy sync work (no compile, flywheel, or briefing). Use when the user says "refresh the dashboard", "update the dashboard", "open the dashboard", or wants the big picture of what Kevin is and what's going on.
allowed-tools: mcp__plugin_agent-kevin_kevin__dashboard, Skill(agent-kevin:focus), Bash
---

# Dashboard

The Agent OS dashboard is the command center: a self-contained `dashboard.html` at
the agent home, regenerated from current state on demand. No server, zero
external requests.

A refresh is intentionally light. Almost everything the dashboard shows — tasks
(`projects/TASKS.md` is rebuilt from frontmatter), skills, settings, persona,
reports, git activity, knowledge stats, compile state, logs — is read live from
disk every time the `dashboard` tool runs, so it's always current with no extra
step. The one piece of derived state the tool does NOT regenerate is the session
radar (the latest Claude Code sessions), so a refresh runs the focus skill's `where-am-i` playbook first to
freshen that, then regenerates. It deliberately skips the heavy `sync` work
(compile, flywheel, briefing, prune, lint-fix) — `sync` owns those and finishes
with these same two steps.

## Run

1. **Freshen the session radar** — invoke the `focus` skill with `where-am-i`
   (via the Skill tool, default 24h window). It owns the radar end to end: scans the latest
   sessions, writes the per-session summaries, and persists the report to
   `reports/radar/`. One source of truth — don't reimplement its steps here.

   **Skip this step** if a where-am-i radar report was already written in this
   run or in the last ~15 minutes (e.g. `sync` just ran, or it's in today's
   reports list) — don't redo work `sync` already did; go straight to step 2.

2. **Regenerate the dashboards** — one call refreshes both `dashboard.html` and
   `projects/TASKS.md` (the two derived views always regenerate together, and
   pick up the radar from step 1):

```
mcp__plugin_agent-kevin_kevin__dashboard
```

Returns `{ path, bytes, tasks }`.

3. Open it for the user (macOS) — ONLY if this session's Bash tool runs
   commands unsandboxed. If the Bash tool description mentions a command
   sandbox, app launches will fail: skip this step entirely (no `open`, no
   `open -a`, no browser launchers) and just include the `file://` path in
   your reply so the user can open it themselves.

```bash
open "<path from step 2>"
```

   If `open` errors anyway, same rule: do NOT retry with other launchers.

4. Reply with one line: the dashboard is refreshed (and open, if the launch
   worked), plus anything the health badge would flag (the tool result alone
   doesn't carry health — skip unless asked).

## Pages

`today` (focus / ongoing / goals / news) · `tasks` (agenda / needs
attention) · `projects` · `sessions` · `brain` (context / memory / threads /
concepts / pipeline / lint) · `reports` · `capabilities` (cheatsheet / skills /
tools / commands / reflexes) · `persona` · `system` (settings / logs /
changelog) · `profile` (reached via the operator card) · `status` (reached via
the health badge). Today opens on Focus, the home focus view (the focus skill
renders it and `dashboard.html` embeds its data as a `focus-data` block). Each
page's header tiles open the tab that explains them. Sub-tabs deep-link:
`dashboard.html#today/focus`, `#tasks/attention`.

## Notes

- Near-pure: the `dashboard` tool never mutates knowledge or task files
  (`projects/TASKS.md` is a derived view, rebuilt from frontmatter). The only
  write a refresh makes is the where-am-i radar report in `reports/radar/`,
  written by the focus skill's `where-am-i` playbook (step 1) — and that step is skipped when a
  fresh one already exists.
- Secrets are redacted at the source (`••••`); never un-redact them.
- Markdown links open via the configured opener app: set the `MARKDOWN_URL`
  env var in `.claude/settings.local.json` (`{path}` placeholder, e.g.
  `markedit://open?path={path}`); defaults to
  `obsidian://open?path={path}&paneType=tab` (new Obsidian tab, dashboard stays put).
- Every `/agent-kevin:sync` also refreshes the dashboard; `kevin dashboard`
  does the same from a terminal.
