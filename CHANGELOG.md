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

## [0.3.15] - 2026-07-24

### Added
- Travel-aware timezone: set `KEVIN_HOME_TIMEZONE` (IANA name) in `.claude/settings.local.json` `env` — `init` now writes it from Step 4. When it differs from the machine's live timezone, the SessionStart `## Today` line appends `✈️ traveling (home: <tz>)`. Unset leaves output unchanged.

### Changed
- `templates/USER.md` + `init`: the single **Timezone** identity field splits into **Home timezone** (static home base) and **Current timezone** (read from the session context's `## Today` line, follows travel).
- Morning/evening briefings compute the Hijri date in the operator's **current** timezone (the `## Today` line), falling back to the home timezone in `USER.md`.
- Dashboard operator card reads the new **Home timezone** field, with fallback to the legacy **Timezone** label.

### Upgrade
- `template/USER.md: optional` — Timezone line splits into Home/Current timezone.
- `script: required` — runs `skills/upgrade/scripts/0.3.15.ts`: seeds `KEVIN_HOME_TIMEZONE` in `.claude/settings.local.json` `env` from USER.md's home timezone (no-op if already set; reports when USER.md has no valid IANA name so the operator can set it by hand).

## [0.3.14] - 2026-07-23

### Added
- `where-am-i` **triage mode** (`/agent-kevin:where-am-i triage [scope]`, or when the operator asks "what should I tend to / work on next / which session needs me"): ranks the live sessions by what most needs a human (decision-pending, importance, momentum), presents the top few via an `AskUserQuestion` interview, and hands back the `claude --resume` command for the chosen one. Ephemeral — no report.
- `where-am-i` standard digest now leads with a compact index table (one row per session, state emoji first) above the buckets; skipped when there are ≤2 sessions.
- `init` prerequisite check now notes `poppler` as an optional dependency — the Read tool renders PDF pages via its `pdftoppm` binary (`brew install poppler` / `poppler-utils`).

### Changed
- `init` engineering defaults: when a built-in tool reports a missing dependency, relay its install hint and stop rather than improvising a fragile fallback.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.3.13] - 2026-07-16

### Added
- `api-collections` skill: draft API request collections the operator opens and fires from their own client. Client-agnostic core with per-client **adapters** (Bruno shipped; plain-`curl` fallback when no client is installed). The Bruno adapter warns about its silent soft-failures (malformed-YAML drop, `.env`-read-at-open, unresolved-placeholder false green) and parse-checks each file after authoring.
- `curl_run` MCP tool: run an authored request end-to-end to verify it before handing it off (the api-collections verification path).
- `browser_screenshot` and `browser_pdf` accept a CSS-injection input to tweak the page before capture (#16).
- Flow-scoped secrets (`.env`) and QA fixtures (`config.json`) for HOME browser flows.

### Upgrade
- `settings: mandatory` — add two allow-list entries to the HOME's `.claude/settings.json`: `mcp__plugin_agent-kevin_kevin__curl_run` (new always-on core tool) and `Skill(agent-kevin:api-collections)` (new model-invocable skill).

## [0.3.12] - 2026-07-13

### Added
- `browser_flows` now discovers flow definitions from the HOME's `.claude/browser-flows/` directory, so an operator can author reusable browser flows in their own home alongside the plugin-shipped ones.

### Fixed
- Robust worktree teardown on native Windows: kills processes holding the worktree, requires PowerShell 7+ (`pwsh`), and fully tears down the checkout instead of leaving a husk.

### Upgrade
- `template/CLAUDE.md: mandatory` — new note under the Platform section: on native Windows, PowerShell 7+ (`pwsh`) is required (scripts never use the built-in 5.1 `powershell.exe`).

## [0.3.11] - 2026-07-12

### Added
- `video_frames` MCP tool — extracts still frames from a local video for visual analysis, running outside the Bash sandbox so it can read videos in `~/Downloads`, `~/Desktop`, `~/Documents` (which ffmpeg-under-Bash can't). Modes: `scene` (default — one frame per visual change, ideal for screen recordings of a flow), `interval`, `count`. Requires `ffmpeg` on PATH.
- `mermaid` skill — validates and iterates on a Mermaid diagram before it ships (Tier 1 parse-check every block; Tier 2 render + visual critique for diagrams headed to a rendered surface). Runs on `/mermaid`.
- `permission-check` skill — interprets a Claude Code permission prompt from a screenshot (or text) and grades how safe it is to allow (🟢/🟡/🔴), then writes a graded report so repeated decisions build a corpus for future allowlist automation.
- `permissions` report category — home for `permission-check` output; surfaces as a dashboard filter chip.

### Changed
- Database tools (`database_query`, `database_schema`, `database_fork`) now accept any legal Postgres database name, not just a fixed pattern.
- README refresh.

### Upgrade
- `deps: required` — new dep `mermaid` (~11.16.0); run `bun install` in `mcp-server`.
- `settings: mandatory` — add to `permissions.allow`: `mcp__plugin_agent-kevin_kevin__video_frames`, `Skill(agent-kevin:mermaid)`, `Skill(agent-kevin:permission-check)`.
- `manual: none` — `video_frames` needs `ffmpeg` on PATH to run (`brew install ffmpeg`); only required if you use the tool.

## [0.3.10] - 2026-07-09

### Added
- `CLAUDE.md` template now carries a **truncated-read verification** rule in `## Workflow`: a partial file read is never a basis for a conclusion — when a Read returns a partial view (or you've only seen part of a query, match-set, or config), page through or grep the rest before asserting, labeling, or acting on it.

### Upgrade
- `template/CLAUDE.md: mandatory` — add the truncated-read verification bullet to your HOME `CLAUDE.md` → `## Workflow` (right after the "Verify before claim" line).

## [0.3.9] - 2026-07-09

### Added
- `CLAUDE.md` template now carries a **forward-only git** rule in `## Workflow`: fix a bad commit with a new commit on top (`git revert` or a corrective commit), never `--amend`, `rebase -i` squash/fixup, or `reset` + rebuild — even when local and unpushed.

### Changed
- `sync` skill's step-11 closing interview + "Suggested next moves" now freshness-check every candidate against current ground truth (task frontmatter, live artifacts, today's deltas) before offering it, so it stops surfacing next-moves the operator already completed.

### Upgrade
- `template/CLAUDE.md: mandatory` — add the forward-only git bullet to your HOME `CLAUDE.md` → `## Workflow`.

## [0.3.8] - 2026-07-09

### Added
- `remove_worktree` MCP tool — safe git-worktree teardown that runs outside the Bash sandbox (so `git worktree remove` can write the main repo's `.git/config`). Refuses on uncommitted changes (`blocked-uncommitted`), gates committed-but-unpushed work behind an explicit `force` (`blocked-unpushed`), supports a `dryRun` pre-check, never `--force`-removes, runs the repo's `clean` script when present, and leaves the branch intact unless `deleteBranch` is set. Deliberately **not** granted in `settings.json`: it's destructive, so each call prompts for confirmation.
- `setup-worktree` skill gained a **drop/teardown flow** (dry-run pre-check → unwire the VS Code workspace → remove) and, when the GitHub pack is configured, surfaces the branch's PR state to reframe a merged-branch "unpushed" result and frame the branch-delete ask.
- Native-Windows headless-browser support: Chromium is driven over CDP with a `ws` transport, working around a Bun pipe-transport hang; ships a pinned `playwright` (`1.60.0`) with a `playwright-core` patch.

### Upgrade
- `deps: required` — new dependency `ws`; `playwright` pinned to `1.60.0` with a `playwright-core@1.60.0` patch. Run `bun install` in `mcp-server`.

## [0.3.7] - 2026-07-06

### Fixed
- Report-writing skills (`where-am-i`, `flywheel`, `morning-briefing`, `evening-briefing`, `self-review`, `weekly-goals`, `monthly-goals`, `yearly-goals`) now surface the absolute `path` returned by `report_write` instead of the relative `relPath`, so the "📄 Saved to …" line is command-clickable in any terminal (e.g. cmux) without a base directory.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.3.6] - 2026-07-01

### Changed
- `.env` deny baseline in `/init` narrowed: the catch-all `Read(**/.env.*)` is replaced by explicit denies for the secret-bearing variants (`.env.local`, `.env.*.local`, `.env.development`, `.env.production`, `.env.staging`, `.env.test`). Template files (`.env.example`, `.env.sample`, `.env.template`) now read freely, since Claude Code evaluates deny before allow with no glob negation, so narrowing the deny is the only way to whitelist one file. The bare `.env` stays denied; secrets in `.kevin/secrets/` are unaffected.

### Upgrade
- `settings: optional` — in `.claude/settings.json` → `permissions.deny`, replace `Read(**/.env.*)` with `Read(**/.env.local)`, `Read(**/.env.*.local)`, `Read(**/.env.development)`, `Read(**/.env.production)`, `Read(**/.env.staging)`, `Read(**/.env.test)`. Purely a relaxation so `.env.example` becomes readable; skip if you prefer the broader deny.

## [0.3.5] - 2026-06-30

### Added
- `sync` now closes with a next-steps interview: after the dashboard render, it turns the surfaced backlog into a single `AskUserQuestion`. Pick a concrete next move (a suggested move, a flagged overdue/stale item, a due cadence skill, or a pending upgrade), then act on it now or queue it as a task. Gated to fire only when something is actually surfaced; a clean bill still ends on the `✅ Sync complete` one-liner. Cadence/upgrade picks collapse to surfacing the slash command (they stay operator-gated).

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.3.4] - 2026-06-25

### Added
- Read-only GitHub pack: nine MCP tools that shell out to `gh --json` — `github_pr_list` / `github_pr_view` / `github_pr_diff` / `github_pr_checks`, `github_run_list` / `github_run_view` / `github_run_log`, and `github_issue_list` / `github_issue_view`. Lets Kevin review PRs and issues, pull diffs and check status, and diagnose failing GitHub Actions runs (failed-step logs). No write subcommands — commenting, merging, and re-running workflows stay human-in-terminal by design. Runs from inside the MCP server (outside the Bash sandbox, where `gh`'s keychain TLS would otherwise fail), authenticating via a `GITHUB_TOKEN` from `.kevin/secrets/.env`. Repo defaults to `origin` of `KEVIN_CODE_PATH` / first `KEVIN_GIT_REPOS` entry; override per-call with `repo="owner/repo"`.
- GitHub is now an opt-in pack in `/init` and `configure-skills` (new A.2d walk), alongside SEO / Browser / Database.

### Changed
- `self-review` and `yearly-goals` skills now persist their summaries via the `report_write` MCP tool, so each run leaves a durable report in the audit trail.

### Upgrade
- `settings: optional` — the GitHub pack is opt-in. To activate, run `/agent-kevin:configure-skills` (GitHub walk): it grants the nine `github_*` tool permissions, ensures `.kevin/secrets/.env`, and surfaces the steps to mint a fine-grained read-only PAT (`GITHUB_TOKEN`). Requires the `gh` CLI on PATH (`brew install gh`). Existing homes are unaffected until they opt in.

## [0.3.3] - 2026-06-25

### Added
- Sync now surfaces cadence nudges: planning and review skills (the weekly/monthly/yearly-goals trio + self-review) that have come due are listed with the exact slash command to run, driven by a `cadence` block in each skill and a shared `skills/sync/scripts/cadence.ts`.
- Dashboard Skills tab gained auto/manual filter chips so you can split model-invocable skills from slash-only ones.
- `kevin` CLI gained a `database` command group (list/schema/query/fork) mirroring the Database MCP tools for use outside Claude Code.

### Changed
- Consolidated every `process.env` read into a single config-free `shared/env.ts` module. Secret-reading tools (web-search, serpapi, open-page-rank, gsc, database, database_fork) now self-load `.kevin/secrets/.env` on first access regardless of import order, instead of relying on a sibling importing `config.ts` first. A build-time guard test fails if any module outside `shared/env.ts` reads `process.env` directly.
- self-review skill: fixed path drift, added an output watermark and a template-promotion track.
- Dashboard settings/env/secrets tables now wrap long values instead of overflowing.

### Fixed
- Sandbox secrets deny never bit. v0.3.0/v0.3.1 wrote the secrets deny under `sandbox.filesystem.read.denyOnly` — the harness's internal *resolved* shape, not a real settings input key — so Claude Code silently ignored it and files nested under `.kevin/secrets/` (Google OAuth tokens, `.kevin/secrets/.env`) stayed readable by sandboxed Bash, even though `ls` of the dir was blocked. The real key is `sandbox.filesystem.denyRead`; pointing it at the directory (no glob) denies it and everything under it at the OS level, which also sidesteps the gitignore `**`-won't-descend-into-`.kevin` dot-dir trap. `/init` now scaffolds `denyRead` plus a forward-compatible `sandbox.credentials.files` entry (honored on Claude Code v2.1.187+, ignored on older).

### Upgrade
- `script: required` — run `skills/upgrade/scripts/0.3.3.ts` via the `run_upgrade` MCP tool. It drops the dead `sandbox.filesystem.read.denyOnly` key, adds `sandbox.filesystem.denyRead: [".kevin/secrets"]`, and seeds `sandbox.credentials.files`. Idempotent.
- `manual: none` — restart/reload Claude Code after the migration so Seatbelt loads the corrected policy. Verify with `wc -c < .kevin/secrets/<a-token-file>` — it should report "Operation not permitted" (not a byte count).

## [0.3.2] - 2026-06-24

### Added
- New `database_fork` MCP tool: clones a Postgres database into a private copy via `CREATE DATABASE <fork> TEMPLATE <source>` (pure SQL, no `pg_dump`/`pg_restore`, cross-platform), so risky or destructive schema work runs against a scratch copy instead of a shared/live DB. Refuses remote hosts (local only), defaults to the first connection, names the fork after the current git branch, can repoint an env file at the fork, and tears down with `drop: true`. This is what `setup-worktree` now uses to give a worktree its own database on demand.
- Dashboard now shows a presence-only secrets inventory of `.kevin/secrets/` (env key names + Google OAuth files): names and presence checks only, never values.

### Changed
- Database tools renamed for consistency: `db_list` → `database_list`, `db_schema` → `database_schema`, `db_query` → `database_query`. Consumer-visible (permission grants change; see Upgrade).
- `setup-worktree` skill wires up `database_fork` to provision a worktree's database.
- README database section rewritten for the v0.3.0 secrets layout: `KEVIN_DB_*` connection strings now live in `.kevin/secrets/.env`, not `settings.local.json`.

### Fixed
- Hardened the not-yet-released `0.3.0.ts` / `0.3.1.ts` secrets migrations: purge the old `settings.local.json` env block after relocation and strengthen the secrets deny path.

### Upgrade
- `settings: mandatory` — only if you use the Database pack. Replace the renamed tool grants in your project `.claude/settings.json`: remove `mcp__plugin_agent-kevin_kevin__db_list`, `mcp__plugin_agent-kevin_kevin__db_query`, `mcp__plugin_agent-kevin_kevin__db_schema`; add `mcp__plugin_agent-kevin_kevin__database_list`, `mcp__plugin_agent-kevin_kevin__database_query`, `mcp__plugin_agent-kevin_kevin__database_schema`, `mcp__plugin_agent-kevin_kevin__database_fork`.

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
