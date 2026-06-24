# Changelog

All notable changes to **agent-kevin** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

The version that matters is the one in `.claude-plugin/plugin.json`. `/plugin update`
pulls new plugin **code**; it does not touch a consumer's HOME files (`CLAUDE.md`,
`SOUL.md`, settings, rules, …) or run `bun install`. The **Upgrade** block in each
release below is the machine-actionable contract that `/agent-kevin:upgrade` reads
to reconcile a HOME after a code update. Producers write these with
`/agent-kevin:release`.

## Upgrade-block format

Each release carries an `### Upgrade` section. Every actionable line is a single
backticked tag plus a human note:

```
- `<kind>: <severity>` — <note>
```

- **kind** — `deps` · `settings` · `template/<file>` · `file` · `script` · `manual`
- **severity** — `required` (deps/script) · `mandatory` (auto-applied) · `optional`
  (the upgrade asks first, with a diff) · `additive` (copy if absent) · `none`

A `script: <severity>` line means the release ships a one-time migration at
`skills/upgrade/scripts/<version>.ts` (named for this release). `/agent-kevin:upgrade`
runs it via the `run_upgrade` MCP tool — outside the Bash sandbox, so it can
touch deny-gated paths. The script is self-contained, idempotent, and prints a JSON
report; it carries no permanent footprint in the server and may be pruned once the
minimum supported baseline passes it (a `script:` whose file is absent is treated as
already-applied). Use it for heavy data moves; use `manual` for steps a human must do
by hand.

A code-only release writes a single line: `None — code-only, no bun install or HOME changes.`

`/agent-kevin:upgrade` collects every Upgrade block from a HOME's recorded baseline
(`<HOME>/.kevin/version.json`) up to the installed version, coalesces them, backs up
touched files to `.kevin/updates/`, auto-applies the mandatory/additive/deps actions,
and prompts per optional one. The new template files are the source of truth for
*content*; these tags only say *which* files changed and *how aggressively* to apply.

<!-- Add new releases below this line, newest first. -->

## [0.3.1] - 2026-06-24

### Fixed
- Completed the secret-file deny baseline for homes upgraded via the contract. v0.3.0 broadened `/init`'s `permissions.deny` (the dotenv / cert / credential globs plus the two `curl … | sh` Bash denies) and its narrow sandbox `denyOnly`, but the v0.3.0 migration wrote only the secrets-dir Read deny — so a home that ran `/upgrade` (rather than a fresh `/init`) was left with just `Read(**/.kevin/secrets/**)` and missed the rest of the hardening.

### Changed
- `google-auth` tool gained a comment documenting the secrets-dir layout (parity with the worktree + Walle).

### Upgrade
- `script: required` — run `skills/upgrade/scripts/0.3.1.ts` via `run_upgrade`. Tops the project `.claude/settings.json` up to the full `/init` baseline: adds the remaining Read denies (`**/.env`, `**/.env.*`, `**/secrets/**`, `**/credentials/**`, `**/*.pem`, `**/*.key`) and the two `curl … | sh` Bash denies to `permissions.deny`, and `**/.env` + `**/.env.*` to the sandbox `filesystem.read.denyOnly`. Additive and idempotent — never removes or reorders existing entries. Touches only the project settings file, never the global `~/.claude/settings.json`.

## [0.3.0] - 2026-06-24

### Added
- Secrets are centralized into a deny-gated `.kevin/secrets/` directory: credential env vars (`PERPLEXITY_API_KEY`, `SERPAPI_KEY`, `OPENPAGERANK_API_KEY`, `KEVIN_DB_*`) live in `.kevin/secrets/.env` and Google OAuth files in `.kevin/secrets/google/`, loaded once at boot by the MCP server / CLI and never exposed to ad-hoc Bash. A `Read(**/.kevin/secrets/**)` deny keeps the agent from reading its own secrets.
- Versioned upgrade-script mechanism: a heavy one-time HOME migration ships at `skills/upgrade/scripts/<version>.ts` and runs via the new always-on `run_upgrade` MCP tool (outside the Bash sandbox, so it can touch deny-gated paths). Scripts are self-contained, idempotent, fail-loud, and pruned once the minimum baseline passes them.

### Changed
- `/agent-kevin:upgrade` now runs `script:`-tagged migrations through `run_upgrade`; `/agent-kevin:release` detects an in-range migration script and locks the version to its filename instead of asking for a bump.
- `init` and `configure-skills` skills updated for the secrets layout and the new always-on core tool list.

### Upgrade
- `script: required` — run `skills/upgrade/scripts/0.3.0.ts` via `run_upgrade` (relocates secrets to `.kevin/secrets/` and writes the Read deny). Breaking HOME-layout move; idempotent and verified before it strips the originals.
- `settings: mandatory` — add permission `mcp__plugin_agent-kevin_kevin__run_upgrade` (new always-on core tool) and the deny `Read(**/.kevin/secrets/**)`.

## [0.2.9] - 2026-06-23

### Added
- Dashboard Tasks page now has project filter chips (All + one per project, busiest first, with the project's color dot), mirroring the Reports page. They appear on both the agenda and the Needs-attention view, and stay hidden when there's only one project to filter between.
- Task rows show a 💬 comment counter chip (thread entry count) in the summary, and `depends on` ids in the expanded body now link to their task files (live or archived).

### Changed
- Redesigned the expanded task-detail body: a quiet, dot-separated key/value meta block (status · due · updated · depends on) replaces the old `·`-joined dim line, with the blocker reason on its own amber-edged note line. The id itself is now the open-the-file link (no separate footer).
- Needs-attention view rebuilt: Blocked and Going-stale are filterable grouped rows under one filter box (Blocked reads as a single id · why · project row) instead of two separate tables.
- Plugin description updated to engine-agnostic tool wording (headless browser / web search, not Playwright / Perplexity) and a stable "20+ skills" count.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.2.8] - 2026-06-23

### Fixed
- Task prefix resolution is now consistent end-to-end. `buildPrefixMap` gives a project whose prefix is inferred from existing task files precedence over an empty project that derives the same prefix, so an empty project can no longer displace a tasked project's IDs (which would misroute `findTaskById`). `getNextId` now mints IDs through the same collision-resolved prefix that `findTaskById` looks up, removing a second source of truth.
- `create-project` and `archive-project` skills: removed references to the deleted hardcoded `TASKS.PREFIX_MAP` (prefixes are now filesystem-derived), corrected stale `app/` paths to `mcp-server/`, fixed malformed MCP tool invocations, and dropped the dead `HEARTBEAT.md` cleanup step.

### Changed
- Pure task-prefix logic extracted to `mcp-server/src/tasks/prefix.ts` (`derivePrefix`, `assignPrefixes`), keeping `scan.ts` as the filesystem wiring and making the logic unit-testable without a config-backed HOME.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.2.7] - 2026-06-22

### Fixed
- SessionStart banner: the "upgrade available" row now matches the `Label:   value` shape of the Agent/Knowledge/Projects rows (`⬆️ Upgrade:   run ...`) and drops the em-dash, so it aligns with the sibling lines.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.2.6] - 2026-06-21

### Changed
- `templates/CLAUDE.md` engineering standards gain a **Comments** subsection: default to no comment, keep only the *why*, JSDoc-for-consumer-APIs only (always multi-line), no tombstones/archaeology, and fix the name or abstraction instead of explaining awkward code.

### Upgrade
- `template/CLAUDE.md: mandatory` — new "Comments" subsection under Engineering Standards. Additive content; appended after "Code style".

## [0.2.5] - 2026-06-21

### Changed
- `sync` now checks for a pending plugin upgrade as part of its needs-attention step: it compares the installed plugin version against the home's migrated baseline (`.kevin/version.json`) and surfaces a dedicated `⬆️ Upgrade` line in the report when they drift. The check is read-only: `sync` never runs `/upgrade`; the migration stays an operator-gated command. Mirrors the dashboard staleness-warning pattern.

### Fixed
- Dashboard persona-head no longer repeats the agent name + emoji next to the avatar (it already appears in the page title).

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.2.4] - 2026-06-20

### Changed
- The `sync` skill is now model-invocable (dropped `disable-model-invocation`), so Kevin can run a full state refresh on its own and other skills can chain it via the Skill tool (`/upgrade` now chains `sync` after applying a HOME migration). Added to the canonical onboarding grant list (eight → nine skill grants).

### Upgrade
- `settings: mandatory` — add permission `Skill(agent-kevin:sync)` to `settings.json` → `permissions.allow`. Without it, model invocations of `sync` (including the chain from `/upgrade`) prompt for confirmation each time.

## [0.2.3] - 2026-06-20

### Added
- Dashboard now surfaces each session's tasks and plans (radar-refs), so the activity view links straight to the work a session touched.
- Database tool: target a specific database per query and support db-less connections (`db_query` accepts a per-call database; connections without a default database now work). (#5)

### Changed
- **Engine-agnostic MCP tool names.** The browser tools `playwright_screenshot`/`playwright_pdf`/`playwright_markdown`/`playwright_record` are renamed to `browser_screenshot`/`browser_pdf`/`browser_markdown`/`browser_record`, and `perplexity_search` is renamed to `web_search`. The underlying engines are unchanged; only the tool names are now engine-neutral. (`browser_flows` keeps its name.)
- Dashboard History: doubled the captured-briefing snippet cap to 240 chars.
- `release` skill: now asks the maintainer which bump to take (patch/minor/major, each shown with its concrete target version) and, after staging, asks how far to go (commit / commit + tag / commit + tag + push) instead of free-text proposing.
- README: promoted the upgrade/release docs to their own section and simplified the diagram.

### Fixed
- Upgrade-available alert spacing in the dashboard.

### Upgrade
- `settings: mandatory` — only if the **Browser pack** is active. The renamed tools need their `permissions.allow` grants in `settings.json` swapped: remove the old names and add the new ones — `mcp__plugin_agent-kevin_kevin__perplexity_search` → `…web_search`, `…playwright_screenshot` → `…browser_screenshot`, `…playwright_pdf` → `…browser_pdf`, `…playwright_markdown` → `…browser_markdown`, `…playwright_record` → `…browser_record`. (`…browser_flows` is unchanged.) Homes that never activated the Browser pack have no playwright/perplexity grants and need no change.

## [0.2.2] - 2026-06-20

### Fixed
- `init` and `upgrade` skills: the gitignore-tracking logic used the shell `!` negation operator, which fails in the Claude Code Bash tool's eval wrapper (`command not found: !`). Rewritten to be fully `!`-free (nested if/else, octal `\041` for the literal `!`), so the `.kevin/version.json` and compile-cursor negations land regardless of shell. Completes the shell-`!` hardening begun in 0.2.1.

### Changed
- README: added a "How upgrades & releases work" section documenting the two-phase model (plugin code vs. home reconciliation), local behind-detection, the consumer/maintainer flows, and the Upgrade-block format.

### Upgrade
None — code-only, no bun install or HOME changes.

## [0.2.1] - 2026-06-20

### Fixed
- `init` and `upgrade` skills: a literal leading `!` in a shell command can be mangled to `\!` by some interactive shells (zsh history expansion), which silently broke the `.gitignore` negations that keep `.kevin/version.json` and the compile cursor git-tracked. The `!` is now emitted via its octal code `\041` and existence is detected with `!`-free greps, so the negations land regardless of shell.

### Upgrade
None — code-only, no bun install or HOME changes.

## [0.2.0] - 2026-06-20

Versioned release + upgrade tracking. `/plugin update` refreshes plugin code but
never touches a home's scaffolded files or runs `bun install`; this release adds the
contract and tooling to close that gap.

### Added
- **`/agent-kevin:upgrade`** — applies pending HOME migrations after a `/plugin update`: runs `bun install` when a release needs it, auto-applies functionality-critical changes (permissions, new rule/concept files), and asks before touching anything you may have personalized (a SOUL/CLAUDE section). Handles being several versions behind in one pass, backs up to `.kevin/updates/` first, and ends with a sync.
- **`/agent-kevin:release`** — producer tool that cuts a versioned release: detects what consumers need, bumps the version, writes the CHANGELOG entry + Upgrade block, and stages the commit + tag for approval.
- **`CHANGELOG.md`** and the machine-actionable `### Upgrade` block format that `/agent-kevin:upgrade` consumes.
- **Dashboard** — System → Changelog tab, plus an amber "upgrade available" sidebar badge (and a SessionStart banner nudge), driven by a local, zero-network compare of the home baseline against the installed version.
- **`.kevin/version.json`** — the home's template baseline, git-tracked so it survives a clone/restore.

### Changed
- `/init` now records `.kevin/version.json` for fresh homes and grants the upgrade/release skills.
- The `.gitignore` template now tracks `.kevin/version.json` (the same way it already tracks the compile cursor). For existing homes, `/agent-kevin:upgrade` applies this automatically.

### Upgrade
- `settings: mandatory` — add `Skill(agent-kevin:upgrade)` and `Skill(agent-kevin:release)` to `.claude/settings.json` `permissions.allow`.

## [0.1.25] - 2026-06-19

Baseline entry — versioned release tracking begins here. Everything through
v0.1.25 (the knowledge wiki, task system, dashboard, SEO/browser/database packs,
worktree setup, plan-spec / simple-simplify / humanizer skills, the
sync-overdue dashboard warning, path-scoped rules) shipped before this CHANGELOG
existed; consult `git log` for that history.

### Upgrade
- `none: none` — None — code-only baseline, no bun install or HOME changes.
