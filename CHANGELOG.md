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

## [0.3.27] - 2026-08-17

### Added
- **A roadmap is a convention now, not config.** `roadmap.html` lives at the root of
  whatever it covers: the HOME root for your north star, `projects/<slug>/roadmap.html`
  for a project's own plan. The dashboard discovers both without registration — the
  north star leads the sidebar's Surfaces group, and a project that keeps one gets a
  🧭 row on its card. Only the north star is promoted to the sidebar; a project's
  roadmap lives on that project's card, so the sidebar doesn't grow a row per project.
- `create-project` points new projects at the convention (and says not to scaffold an
  empty roadmap); `roadmap` offers the project-root path instead of a nested
  `references/` location and reminds you to list it in the README's `## Structure`.

### Changed
- **Flywheel is framed by the roadmap.** It reads the north star's `ROADMAP` object
  while orienting and uses it to break ties between equally urgent tasks, reads a
  project's own before deciding what to advance, and reconciles milestone statuses its
  work actually moved. Status-value edits only, evidence-backed — structural changes
  and drift go to the operator with `/agent-kevin:roadmap`, never a regeneration.
  `sync`'s quick form carries the same two steps, since that's the path most flywheel
  runs take.

### Fixed
- README's MCP tool count was stale in two places (47 in the tool table, 48 in the
  sample session banner; actual: 52), and `list_worktrees` was missing from the
  Worktree group.
- The sidebar's health and upgrade badges ran past the edge of the fixed-width
  sidebar once the issue list grew past a couple of signals. They wrap now — between
  whole signals, never mid-signal or onto a line-leading `·` — at the same font size,
  in the same sidebar width.

### Upgrade
- `manual: optional` — only if you keep a project roadmap at the old nested path
  `projects/<slug>/references/roadmap.html`: move it to `projects/<slug>/roadmap.html`
  so the dashboard finds it, and add a line for it in that project README's
  `## Structure`. Otherwise nothing — code-only, no bun install, no HOME changes.

## [0.3.26] - 2026-08-13

### Added
- **Name your agent something other than Kevin.** The display name and the plugin
  namespace were the same string, so the only way to run an agent called anything else
  was to fork and give up clean updates. They're now separate: the name is data in
  `IDENTITY.md`, the namespace (`/agent-kevin:`, `KEVIN_*`, `.kevin/`, MCP tool names)
  stays in the manifest. `init` asks for a name, emoji and avatar up front; the session
  banner, the `TASKS.md` header and the knowledge-compile prompts all render it, so
  compiled memory speaks about the agent you actually named.
- **`rename-agent` — rename an existing home.** Rewrites the persona fields, swaps the
  avatar, and sweeps the prose across `SOUL.md` / `CLAUDE.md` / `USER.md` / knowledge /
  projects, leaving the plumbing alone. It refuses to touch `Kevin` sitting against a
  `/` or `\`, so a home at `~/Documents/Agents/Kevin` keeps every path reference intact.
  Double-gated on purpose: `disable-model-invocation`, so it only runs from
  `/agent-kevin:rename-agent` and never fires on its own, **and** deliberately left out of
  the permission grants, so even that raises a confirm prompt. It rewrites the whole brain
  in one pass; both gates are intentional.
- **Unresolved scaffold placeholders are surfaced every session.** `init` and `upgrade`
  substitute `{{TOKEN}}` and both check their own work, but those checks are skill
  instructions. SessionStart now scans the identity files and reports what it finds in
  the banner and the context, so a slip is caught on the next session instead of sitting
  in files that load into every one.

### Changed
- **A home is identified by its data dir, never by `SOUL.md`.** Every agent's home has a
  `SOUL.md`, so that test answered "some agent lives here" when the question is "does
  *this* agent live here". Since the home falls back to cwd when the walk finds nothing,
  the weaker test let one agent read and write inside another's brain.
- **User-level session hooks are no longer supported.** Capture ships only with the
  plugin, which Claude Code loads solely where it's enabled — its own home — so a session
  can only be captured by the agent whose home it started in. Isolation is structural
  instead of defended, and the machinery that defended it (self-defer, an enabled-plugin
  probe, the repeatable `--exclude` flag) is gone. A session started outside a home is
  no longer captured at all.
- **The CLI and the MCP tools refuse to run outside this agent's home.** Both name the
  resolved path and the env var that overrides it, rather than reading an empty tree and
  scaffolding `knowledge/` + `projects/` into whatever repo you were standing in.
- **README rewritten around the launch-from-home convention**, replacing the
  capture-everywhere recipe, plus a new section on naming and renaming an agent.

### Fixed
- **The logger forged the marker that identifies a home.** It created the data dir on
  first write whenever `<AGENT>_HOME` was set, and it runs on every invocation —
  including ones the guards had just refused. Point the var at a typo or a sibling
  agent's home and the refusal itself made the next attempt succeed. Both branches now
  require the dir to already exist.
- **Field readers walked past an empty value into the next line.** `\s` matches
  newlines, so `**Name:**\s*(.+)$` against a blank field captured whatever followed —
  an `IDENTITY.md` with an empty Name made the agent call itself "- **Kind:** AI
  assistant" in the banner, in `TASKS.md`, and in the compile prompts that write its
  name into long-term memory. Same bug returned `type: task` as a task's title when
  `title:` was blank.
- **Guards no longer recommend a destructive repair.** SessionStart told a home with a
  `SOUL.md` but no data dir to run `init`, which offers to overwrite exactly the identity
  files sitting there; it now names both causes (a restore that lost the dir, or another
  agent's home) and gives the one-line fix. `configure-skills` made the same
  recommendation keyed on a missing `CLAUDE.md`, which init legitimately writes as
  `CLAUDE.local.md`.
- **A blocked task can be cancelled without a detour through `active`**, which had been
  parking abandoned work in `active` between the two hops and misreporting it.
- **`browser_flows` drives chromium over CDP on native Windows** (#17).

### Upgrade
- `manual: required` — **Delete the `session-capture` hooks and any `KEVIN_HOME` from
  `~/.claude/settings.json`** (and any `export KEVIN_HOME` in your shell rc). A plugin
  update can't touch that file. While the hooks remain they still capture, but
  `--exclude` is now ignored, so sibling-agent and Ring-1 paths you excluded on purpose
  are being captured; the CLI warns when it sees the flag. `KEVIN_HOME` is machine-wide
  and outranks launch-directory resolution, so it also blocks running a second home.
  After removing them, always launch from the agent home.
- `manual: none` — **restart Claude Code after `/plugin update`, before anything else.**
  This release rewrites MCP-server code (the home gate, the display-name resolver, the
  logger, session context) and the running server holds the old code until Claude Code
  reloads. Deleting the hooks above also only takes effect on relaunch, since the host
  reads them at launch.
- `template/CLAUDE.md: mandatory` — placeholder-only change. Upgrade resolves
  `{{AGENT_NAME}}` from your `IDENTITY.md` before diffing, so for a home whose Name is
  `Kevin` the merge is a verified no-op; for a renamed home it arrives in that name.
- `template/SOUL.md: optional` — same placeholder-only change, and it's confined to the
  first line of `## Vibe`. If the merge offers you any *other* section, that is your own
  earlier customization drifting from the template, not something this release changed —
  **decline it.** Accepting would overwrite your edits with the stock text.

`templates/IDENTITY.md` also changed, and is deliberately **not** listed above: the edit
is confined to the preamble and `## Who`, which upgrade never reconciles. That block is
your agent's persona, and the avatar line can't survive a diff round trip. New homes only,
nothing to do.

## [0.3.25] - 2026-08-10

### Added
- **`list_worktrees` — read-only worktree triage.** The audit sibling of
  `setup_worktree`/`remove_worktree`: per-worktree branch, dirty and unpushed counts,
  ahead/behind and merge state vs the base ref (preferring `origin/<base>`),
  squash-merge detection via `git cherry`, last-commit age, and a verdict
  (`deletable` / `uncommitted` / `unpushed` / `pushed-unmerged` / `missing` / `main`).
  Also exposed as `kevin worktree list <repoPath>`; the `setup-worktree` skill gains
  the audit rendering + teardown-offer flow, so "which worktrees can I delete?" gets a
  ranked answer instead of a shrug.
- **`github_pr_comments` — the GitHub pack can finally read a review.** `gh pr view`'s
  comments field covers the conversation tab only, so a PR whose whole discussion is
  inline threads read as empty to every tool in the pack. One GraphQL query now
  returns review threads (path, line, diff side, resolved/outdated state), review
  submission bodies, and conversation comments.

### Fixed
- **Hooks silently degraded when a session roamed out of the HOME tree.** The home
  walk-up started from the *shell's* cwd, so after a `cd` into a worktree every
  subsequent hook found no marker above it and fell back to the pre-init branch:
  SessionStart handed the agent "run init" in place of its context, and session
  capture bailed — both silently, because the logger also refuses to write with no
  home resolved. `CLAUDE_PROJECT_DIR` (the launch dir, which doesn't roam) now stands
  in when cwd has wandered off.
- **`github_pr_view` no longer 403s on repos where CI reports as check runs.** It
  requested `statusCheckRollup`, a GitHub-App-only capability no fine-grained PAT can
  hold, which failed the entire view. The field is dropped; `github_pr_checks` owns
  that question and fails on its own.
- **GitHub-pack docs matched back to reality.** The README tool table had drifted
  (48 vs an actual 51 — `github_fast_forward`, `curl_run`, `video_frames` never
  added), the pack-activation blurb and deconfigure list omitted the
  `github_issue_*` grants, and the PAT walks told operators to grant **Checks** — a
  permission that doesn't exist on fine-grained PATs (Actions: Read answers it). The
  Contents note now also covers `github_pr_diff`, and sync's `FETCH_FAILED` guidance
  can now discriminate an unapproved token from a missing Contents grant.

### Changed
- Sync's fast-forward docs teach the shared `AGENT_*` env spellings, with the
  per-agent prefixed form noted as the override that wins.

### Upgrade
- `settings: additive` — if you use the GitHub pack, add
  `mcp__plugin_agent-kevin_kevin__github_pr_comments` to `permissions.allow` (new
  pack homes get it at activation) so review reads don't prompt. Core allow list is
  unchanged: `list_worktrees` rides the `setup-worktree` skill's `allowed-tools`.
- `manual: none` — if your fine-grained PAT was minted from the old walk, check it
  has **Actions: Read** (the walk used to name a nonexistent "Checks" permission);
  without it `github_pr_checks` can't read check-run CI. Everything else works as-is.

## [0.3.24] - 2026-08-07

### Added
- `configure-skills` Section B — a guided walk for registering **external remote MCP
  servers** (an `https://` endpoint + bearer token) into `<HOME>/.mcp.json` via a
  hardened `mcp-remote` wrapper. The wrapper fails fast with a loud stderr message
  when its token is empty, never falls back to `$PWD` for the secrets path, pins the
  `mcp-remote` version, and uses bare-`$VAR` shell logic (the host interpolates
  `${VAR}` in `.mcp.json` before the shell runs).

### Fixed
- **Browser OAuth tab storm from hand-rolled remote-MCP wrappers.** `mcp-remote`
  answers a 401 by launching an interactive browser OAuth flow (client registration +
  authorize tab) and has no flag to disable it. A wrapper that execs it with a
  silently-empty token — e.g. a secrets path resolved from `$PWD` in a session
  launched from a subdirectory — opens a fresh tab on every server spawn, across
  every session, until the operator kills it. Reported by multiple operators. The
  Section B wrapper shape makes this unreachable: an empty credential now means one
  failed server in `/mcp`, never a browser.

### Upgrade
- `manual: required` — if your `<HOME>/.mcp.json` registers any `mcp-remote` server
  (grep it for `mcp-remote`), harden each wrapper to the Section B shape in
  `skills/configure-skills/SKILL.md`: add the empty-token fail-fast guard before the
  `exec`, replace any `$PWD` secrets fallback with your absolute HOME path, and pin
  `mcp-remote@0.1.37`. Ask Kevin to "harden my remote MCP wrappers per configure-skills
  Section B" and it will patch and parse-check the file. If the storm is active right
  now: `pkill -f mcp-remote`, close the pending authorize tabs without clicking
  through, then apply the fix and restart sessions. No `.mcp.json` remote servers →
  nothing to do.
  **Windows:** WSL2 homes use the POSIX wrapper and `pkill` as-is. Native homes use
  the pwsh 7+ variant in Section B, and kill an active storm with
  `Get-Process node | Where-Object { $_.CommandLine -match 'mcp-remote' } | Stop-Process -Force`
  (never a blanket node kill).

## [0.3.23] - 2026-08-06

### Added

- **Sync commits the brain.** A new step 11 runs `skills/sync/scripts/commit-brain.ts` after the dashboard render, so each run's own outputs land in history instead of waiting for someone to remember. The script is the guard, not the model: it acts only when the HOME repo is on `main`/`master` with **no remote configured**, and it never pushes and never amends. Changes are grouped into ordered commits (`Sync: update knowledge`, `Sync: update projects`, `Sync: save reports`, `Sync: update state`) so the log stays readable. Untracked files outside those roots are reported back as `leftUncommitted` rather than swept in, and `.gitignore` still fences secrets. Covered by a 10-case guard matrix including the split-git-dir topology.

### Changed

- Sync's output block gains a `💾 Brain` line, and the closing interview moves to step 12.

### Upgrade

- `manual: optional` — no action for a normal HOME whose `.git` lives inside the home directory; sync will just start committing. If your HOME uses a **split git dir** (the git directory outside the home tree), grant that path in `.claude/settings.local.json` under `permissions.additionalDirectories` and the sandbox's `filesystem.allowWrite`, or step 11 will report `COMMIT_BLOCKED` and change nothing. A HOME repo with a remote configured is skipped by design, since pushing stays your workflow.

## [0.3.22] - 2026-08-06

### Added

- **Agent-neutral env naming.** Every config knob now has a shared, agent-neutral `AGENT_*` name alongside this agent's own spelling (`KEVIN_*`), which is derived from the plugin manifest name and always wins. The fork seam collapses to `plugin.json` plus one test assertion. New side-effect-free `shared/naming.ts` owns the prefix, the shared/override resolution rule, and the runtime data-dir name (`AGENT_RUNTIME_DIR` override, validated as a bare folder name). Existing `KEVIN_*` configs work unchanged — no migration.
- **Init asks which model Kevin runs on** (Fable default vs Opus) and writes the literal value to settings.
- **Relocatable reports root.** Init's custom-paths step now covers `reports/` alongside `knowledge/` and `projects/` (`AGENT_REPORTS`), grants the outside-home permissions, and derives `plansDirectory` from the resolved path.
- Onboarding plants HOME-scoped env keys under the shared `AGENT_*` spellings; the README documents the two-spelling rule.

### Fixed

- Prefix derivation fails loud on a missing or malformed plugin manifest instead of silently disabling every per-agent override.
- The home walk-up and the flow-env secrets gate both honor the default runtime-dir name during a rename migration window, so the secrets store can't be resolved under (or read from) the wrong root.
- The logger no longer scaffolds a runtime dir in a foreign cwd — a plugin hook firing in someone else's checkout logs to stderr only. Log level/file gain the per-agent override spellings.
- Bash-driven skills (where-am-i, setup-worktree, init snippets) resolve env vars with the chained two-spelling form instead of reading one spelling literally.
- The browser-flows harness reads the canonical `AGENT_HOME` instead of throwing on a missing per-agent variable.

### Upgrade

- `manual: none` — everything is backward-compatible; existing `KEVIN_*` settings keep working. Optionally rename HOME-scoped keys (`.claude/settings.local.json` env, `.kevin/secrets/.env` `KEVIN_DB_*`) to the shared `AGENT_*` spellings for portability — keep `KEVIN_HOME` prefixed in machine-wide `~/.claude/settings.json` on multi-agent machines.

## [0.3.21] - 2026-08-05

### Fixed
- **`init`'s prerequisite gate could pass on a Mac with no developer tools installed.** The checks used `command -v`, but on macOS `/usr/bin/git` and `/usr/bin/python3` are xcode-select shims — one shared ~118KB binary hard-linked under roughly 78 tool names — that sit on PATH whether or not the Command Line Tools exist. So `command -v git` succeeded on a machine with no git, init declared prerequisites met, and the failure only surfaced later when something tried to use it. Exactly the fresh-Mac case a non-technical operator arrives with. Verified 2026-08-05: with the developer directory unresolvable, `command -v git` passes while `git --version` exits 1. Hard requirements are now **functional probes** (`bun --version`, `git --version`, `python3 --version`), which also catch a broken install generally.
- **A failing `git` on macOS now names the right remedy.** `xcode-select -p` is checked, and when the tools are absent init prints `xcode-select --install` and stops — rather than pointing at a git-scm.com download, which doesn't address the actual cause.

### Added
- **Homebrew is surfaced conditionally, not required.** Nothing in either plugin calls `brew`; it's only the install path for `gh`/`poppler` on macOS. So it's mentioned only when one of those is missing and the operator would otherwise hit a second wall mid-fix.
- **`init` probes for `gh`.** The prereq gate checked `bun`, `git`, `python3` and `pdftoppm` but not `gh` — so a missing GitHub CLI passed cleanly and then threw `gh CLI not found on PATH` mid-session from the first GitHub-pack call, including sync's code refresh. Now surfaced as a conditional NOTE ("needed only if you activate the GitHub pack"), since nothing outside that pack uses it. The prose also records where the macOS toolchain actually comes from: `git` and `python3` ship with the Xcode Command Line Tools and need no Homebrew, whereas `gh` is bundled with neither Claude Code nor this plugin and therefore does.
- **The GitHub pack walk checks `gh` before granting.** `configure-skills` stated the requirement in prose but never verified it, so the pack could activate cleanly and fail on first use. It now probes and offers a choice — continue and install after, or stop and come back — rather than hard-stopping, because the PAT-minting steps are still worth doing in the same sitting.

### Changed
- **The GitHub pack is default-ticked when a code path was given at Step 4b.** `github_fast_forward` needs `GITHUB_TOKEN`; without the pack it returns `NOT_CONFIGURED` and the operator's checkouts silently never refresh. That's the one failure mode that degrades *answers* rather than raising an error — Kevin keeps grounding confidently against a frozen checkout — and an operator who just told init where their code lives has effectively asked for the opposite. Still unticked when Step 4b returned `skip`, which stays the common case for a Kevin home.

### Upgrade
- `manual: none` — if you activated the GitHub pack before this release, confirm `gh` is on your PATH (`command -v gh`; macOS `brew install gh`). Nothing else to reconcile.

## [0.3.20] - 2026-08-05

### Added
- **`github_fast_forward` — sync step 0 moves into the GitHub tool family.** Fast-forwards the default branches of the configured checkouts by **slot** (first local match of `main`/`master`, and of `develop`/`dev`), so a vestigial `master` beside a live `main` is never touched. Authenticates with the existing fine-grained read-only PAT over HTTPS: one `fetch --prune` per repo, then every ref update is local and needs no credential. The checkout's own remote is neither used for transport nor rewritten, so an SSH remote keeps working for the operator's own pushes. Guard matrix pinned by tests in `mcp-server/src/tools/github.test.ts`.

### Fixed
- **Sync step 0 was a guaranteed no-op in any sandboxed session.** It ran `git fetch` through the Bash tool, and the Claude Code seatbelt gives non-proxied clients no DNS at all — so every repo with a `git@github.com:` remote failed at hostname resolution. It also reported that as `FETCH_FAILED`, conflating "no egress from this process" with "this repo is broken." Moving the work into the MCP server (which runs outside the sandbox, the same reason the rest of `github_*` lives there) fixes it, and `FETCH_FAILED` now carries a `reason` of `NO_ACCESS` / `AUTH` / `NETWORK` so the report says which.
- **A PAT the org hasn't approved is no longer misreported as a bad credential.** Verified against a live org: GitHub answers `403` on the git endpoint in that case, which the classifier scored as `AUTH` — telling the operator to re-mint a token that was perfectly valid. `AUTH` is now only for a credential GitHub rejects outright; `403`, `404 Repository not found`, and `permission denied` all read as `NO_ACCESS`, whose fix is the Contents grant plus org approval.
- **The GitHub PAT scope list was missing `Contents: Read`** and actively told operators they didn't need it. `git fetch` authenticates against `Contents`, so a token minted from the old instructions fails the fast-forward as `NO_ACCESS` while the PR and issue tools work fine. `Contents: Read` confers no push ability; writing needs `Contents: Write`, which is never requested.
- **`config` froze every filesystem path at import time, so whichever module imported it first decided where the whole process wrote.** Anything that set `KEVIN_HOME` afterwards — a hook, the CLI, a test fixture — was silently ignored. `FOLDERS` and `FILES` are now getters that resolve live per access, so the existing call sites are unchanged and import order no longer decides anything.
  The concrete hazard: because Bun runs every test file in one process, a single unrelated import in an early-loading test file could freeze config to the operator's real home and have the session-capture suite write fixture data into their actual `knowledge/raw/sessions/`. A new `bunfig.toml` preload now pins `KEVIN_HOME` to a throwaway tree for every suite, so that's structurally impossible regardless of import order, and `config.test.ts` pins the live-resolution behaviour.
- **Secret loading had the same import-time freeze.** `loadSecretsEnv()` latched on a boolean and ran eagerly at import, so the first module to pull `shared/env` decided which home's `.kevin/secrets/.env` the process used forever — the per-read calls could never correct it, making the module's own "no import-order discipline to forget" promise untrue. It's now keyed on the resolved secrets file, so a changed `KEVIN_HOME` re-reads (and drops the previous store's keys so they can't leak across homes).
- **Six modules still froze a home-relative path at import, re-introducing the import-order hazard the getters removed.** `session-capture`'s lock dir, `status/collect`'s TASKS.md path, `browser-flows`' HOME flows dir, `google-auth`'s secrets subpaths, and the captures dir in `tools/browser` + `media/frames` were all module-scope `const`s built from `FOLDERS` getters — frozen to whatever home was current at first import. Each now resolves at call time (the two captures dirs reuse config's existing `BROWSER.CAPTURES_DIR` getter instead of re-deriving the path); `google-auth`'s unconsumed `CLIENT_FILE` export dropped along the way.

### Changed
- **`init` no longer grants the fast-forward git verbs** (`git fetch`, `git merge --ff-only`, `git rev-parse`, `git show-ref`). They existed only for the Bash version of step 0; the MCP tool needs none of them, so the baseline goes back to being tighter.
- **Step 0 is now GitHub-pack-gated, and never fails the chain.** A home without `GITHUB_TOKEN` gets a `NOT_CONFIGURED` report rather than a tool error, and a home with no codebase at all — common for Kevin — reports an empty list instead of erroring, so the rest of the sync chain runs untouched either way.
- **`config` owns the configured-checkout list.** `configuredRepoPaths()` (`KEVIN_CODE_PATH` plus `KEVIN_GIT_REPOS`, deduped after tilde expansion) and `extraGitRepos()` both live there and resolve live, replacing a frozen `EXTRA_GIT_REPOS` const and a duplicate parse inside the GitHub tool. Tilde expansion now happens once, at the input boundary.
- **`expandTilde` has one owner.** Three copies had accumulated in `config.ts`, `shared/env.ts`, and `shared/utils.ts` — every shared home for it blocked by an import cycle — and they had already drifted, with two handling `~/foo` but not a bare `~`. It now lives in `shared/paths.ts`, a stdlib-only leaf every layer can import. A follow-up sweep found two more private variants (`tools/github.ts`, plus an inline one in `media/frames.ts` that mangled a bare `~`); both now import the shared helper, and the `bunfig.toml` comment now says "agent home" rather than a specific env var, so the file stays fork-agnostic.
- **Five workaround rationales corrected, one simplification taken.** `curl.ts` no longer imports `@/config` lazily inside its handler to dodge the freeze; `status/html.ts`, `status/html.test.ts`, `tasks/prefix.test.ts`, `tools/upgrade.test.ts`, and `shared/env.ts`'s header all described a constraint that no longer exists. `bin/kevin` keeps its dynamic imports — the specifiers are computed from the plugin root, so they cannot be static, and they load one subsystem per invocation instead of all of them — but its comment now names those reasons instead of the env-ordering one.

### Upgrade
- `settings: additive` — add `mcp__plugin_agent-kevin_kevin__github_fast_forward` to `permissions.allow` if you use the GitHub pack, so `/agent-kevin:sync` step 0 doesn't confirm per run.
- `template/CLAUDE.md: mandatory` — new "Scratch files get a `mktemp` name" rule under Platform ($TMPDIR is per-user, concurrent sessions clobber fixed names).
- `manual: none` — if you minted your PAT before this release, add **Contents: Read** to it (Repository permissions, read-only). Without it step 0 reports `NO_ACCESS`. Everything else in the GitHub pack keeps working either way.

## [0.3.19] - 2026-08-03

### Added
- **`sync` step 0 — fast-forward the code checkouts.** Before the knowledge chain runs, sync fetches every repo in `KEVIN_CODE_PATH` + `KEVIN_GIT_REPOS` and fast-forwards whichever of `main` / `master` / `develop` / `dev` already exist locally. Makes `/agent-kevin:sync` the single command a non-technical operator ever has to run — code freshness rides along instead of being a git chore they'd have to remember. Engineers benefit too: default branches in reference checkouts stop drifting weeks behind. Both env vars are optional, so a Kevin with no codebase configured skips the step silently. Strictly forward-only and heavily guarded — only branches that already exist locally are touched (never conjures a `develop`), non-fast-forward updates are refused rather than forced, a dirty checked-out branch is reported as `SKIPPED_DIRTY` and left alone, main checkouts only (a worktree's `.git` is a file), and a failed fetch degrades to a report line instead of failing the sync. Outcomes surface in a new `🖥 Code` block.

  **Safe for heavy multi-worktree work**, verified empirically against git 2.50 rather than assumed. The step runs only `fetch`, `merge --ff-only`, and read-only queries — it never checks out, stashes, resets, rebases, cleans or commits, so a current branch cannot be switched underneath the operator. A branch checked out in a linked worktree is refused *by git* (`refusing to fetch into branch … checked out at …`) and reported as the informational `CLAIMED_BY_WORKTREE` rather than being conflated with a real divergence; a live worktree holding uncommitted work came through a full run with its HEAD, tracked changes and untracked files untouched. An in-progress rebase is likewise refused and survives intact, detached HEAD only ever sees a ref move (no file, index or HEAD change), and `--prune` removes remote-tracking refs without deleting local branches.

### Changed
- **`init` grants the fast-forward git verbs** (`git fetch`, `git merge --ff-only`, `git rev-parse`, `git show-ref`) in the baseline `permissions.allow`, so sync's step 0 doesn't prompt mid-run. Nothing destructive is added — force/reset/rebase stay denied.

### Fixed
- **`upgrade` no longer reconciles a home against a stale template set when the loaded plugin is a version-pinned cache dir.** The version still comes from `CLAUDE_PLUGIN_ROOT` (never `installed_plugins.json`, whose record lags a directory-type marketplace), but when that root is a `plugins/cache/<mkt>/<plugin>/<version>` copy, the skill now reads the marketplace source's `plugin.json` and reports `available=`. A newer source version stops the run with the `/plugin marketplace update` → `/plugin update` → restart path, because the CHANGELOG bundled beside a pinned copy cannot describe migrations released after it. Advisory and best-effort: any lookup miss leaves `available` empty and changes nothing.

### Upgrade
- `settings: additive` — add `Bash(git fetch *)`, `Bash(git merge --ff-only *)`, `Bash(git rev-parse *)`, `Bash(git show-ref *)` to `permissions.allow` so `/agent-kevin:sync` can refresh your checkouts without a prompt per repo. Union merge, nothing removed.

## [0.3.18] - 2026-08-03

### Added
- `where-am-i` checkpoint mode (`/agent-kevin:where-am-i checkpoint`): writes a short pickup note for the *current* session as a chat reply, so the SessionEnd capture files it into knowledge. Incremental by construction, no cursor or state file.
- Dashboard **Surfaces** group in the sidebar, discovered from disk on every render: a HOME-root `roadmap.html` leads, then every `projects/<slug>/dashboard.html`, alphabetically. Zero config, no registry.
- Malformed-task health signal: task files whose frontmatter won't parse are collected and surfaced as a warning callout in `TASKS.md` plus a fifth blocking dashboard signal, instead of silently vanishing from every scan.
- `init` recommends the split layout (`~/Documents/Agents/<AgentName>` for the home, repos in a separate code tree), refuses to scaffold into a code repo without confirmation, and flags iCloud Documents sync.

### Changed
- Agent home resolution goes through a shared `.kevin`-marker walk-up (`agentHomePath()` / `isAgentHome()`): `KEVIN_HOME` wins, else walk up from cwd anchoring on this agent's data dir, else cwd (pre-init only). A session launched inside a code repo can no longer anchor `.kevin/` state, captures, or logs to that repo.
- Mutating skills (`upgrade`, `sync`, `configure-skills`, the goals watermarks, cadence) fail loud with `NOT_AN_AGENT_HOME` rather than writing into whatever tree the session ran in. The goals skills' inline watermark one-liners collapse into a shared `watermark.ts`.
- `init` writes `permissions.additionalDirectories` and `sandbox.filesystem.allowWrite` for the **code root** whenever `KEVIN_CODE_PATH` resolves outside the home, and derives `KEVIN_GIT_REPOS` from the main-checkout repos beside it (`.git` directories only, so sibling worktrees don't flood the list).
- `where-am-i` takes comma-separated scope roots (cwd + home + code root) so the radar sees home and code-repo sessions across separate trees; `setup-worktree` guidance points at the code root.
- `api-collections` Bruno adapter notes the Bruno v4 deltas (`setEnvVar` now persists → secrets rule); `roadmap` render check notes the entry-animation blank-section pitfall.

### Fixed
- Session radar prefers an operator's `/rename` custom title over the first-prompt auto-title (matching Claude Code's own `customTitle || aiTitle` precedence), so restored sessions stop being named after the "catch up and continue" instruction.

### Upgrade
- `template/CLAUDE.md: mandatory` — Knowledge Structure and Git Worktrees sections describe the split layout (`~/Documents/Agents/<AgentName>` home, repos in a separate code tree).
- `settings: optional` — when your code tree lives outside the home, add `permissions.additionalDirectories: ["<CODE_ROOT>"]` and `sandbox.filesystem.allowWrite: ["<CODE_ROOT>"]` (code root, not a single repo, so sibling worktrees and a separated agent git dir stay writable). Skip for nested homes or homes with no code path.
- `manual: none` — **restart Claude Code after `/plugin update`, before syncing.** This release changes MCP-server code (home resolution, dashboard, task scan); the running server holds the old code until Claude Code reloads, so a sync before the restart runs against a stale server.
- `manual: none` — optionally widen `KEVIN_GIT_REPOS` in `.claude/settings.local.json` to the repos beside `KEVIN_CODE_PATH` (comma-separated) for a fuller SessionStart git-activity block.

## [0.3.17] - 2026-07-30

### Added
- `roadmap` skill: wizard-built strategic roadmap surfaces — interviews for the frame (shape, horizons, lanes, accent scheme), harvests milestones from the task board / READMEs / git history, renders a self-contained dark/light HTML page from the house template (`references/template.html` + `DESIGN.md`). Model-invocable; fires on "roadmap", "north star", "plan-on-a-page" asks.
- Accent-scheme presets in the roadmap wizard: purple (template default), green, gold, or a typed hue via Other; `DESIGN.md` carries the token sets and per-preset dark tints.

### Changed
- `init` allow list gains `Skill(agent-kevin:roadmap)` so auto-invocation never prompts.

### Upgrade
- `settings: mandatory` — add permission `Skill(agent-kevin:roadmap)`.

## [0.3.16] - 2026-07-24

### Added
- Dashboard operator card is travel-aware: when `KEVIN_HOME_TIMEZONE` differs from the machine's live timezone, the card (sidebar + Profile header) stacks `🏠 <home>` over `✈️ <current>`. At home it stays a single plain timezone line, unchanged.

### Changed
- `morning-briefing` and `sync` skills name the Perplexity `web_search` tool explicitly instead of built-in `WebSearch`, so the briefing's news pull uses the intended provider.

### Fixed
- Dashboard operator card renders only the IANA token of the home timezone, stripping any annotation carried on the timezone field.

### Upgrade
- None — code-only, no bun install or HOME changes.

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
