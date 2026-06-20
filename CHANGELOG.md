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

- **kind** — `deps` · `settings` · `template/<file>` · `file` · `manual`
- **severity** — `required` (deps) · `mandatory` (auto-applied) · `optional`
  (the upgrade asks first, with a diff) · `additive` (copy if absent) · `none`

A code-only release writes a single line: `None — code-only, no bun install or HOME changes.`

`/agent-kevin:upgrade` collects every Upgrade block from a HOME's recorded baseline
(`<HOME>/.kevin/version.json`) up to the installed version, coalesces them, backs up
touched files to `.kevin/updates/`, auto-applies the mandatory/additive/deps actions,
and prompts per optional one. The new template files are the source of truth for
*content*; these tags only say *which* files changed and *how aggressively* to apply.

<!-- Add new releases below this line, newest first. -->

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
