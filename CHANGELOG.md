# Changelog

All notable changes to **agent-kevin** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/).

The version that matters is the one in `.claude-plugin/plugin.json`. `/plugin update`
pulls new plugin **code**; it does not touch a consumer's HOME files (`AGENTS.md`,
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
(`<HOME>/.state/version.json`) up to the installed version, coalesces them, backs up
touched files to `.state/updates/`, auto-applies the mandatory/additive/deps actions,
and prompts per optional one. The new template files are the source of truth for
*content*; these tags only say *which* files changed and *how aggressively* to apply.

<!-- Add new releases below this line, newest first. -->

## [Unreleased]

### Fixed
- **A reviews read is incomplete when Apple's feed drops a storefront that has reviews.** The feed sometimes returns an empty first page for a storefront it served minutes earlier. `appstore_reviews` used to call such a read `complete` whenever any other storefront answered, so a pulse or reviews run could record its `reviews_through` past reviews it never saw. A storefront with reviews seen before that comes back blank now leaves the read incomplete and is named in the warnings.

### Changed
- **The Xcode pack grants `DocumentationSearch` by name.** `/agent-kevin:configure-skills` adds `mcp__xcode__DocumentationSearch` to `permissions.allow` beside `mcp__xcode__*`, so Apple's documentation lookup keeps its grant if the glob is narrowed, and deconfigure revokes both.

### Upgrade
- `settings: optional` — only in a home with the Xcode pack: add `mcp__xcode__DocumentationSearch` to `permissions.allow` in `.claude/settings.json`.

## [0.8.5] - 2026-10-22

### Changed
- **Helpdesk raises a ticket as a bug, a feature or a task.** `/agent-kevin:helpdesk raise <id>` (or "raise 318") proposes the kind with a one-line reason, then files it wherever the queue profile sends that kind: a task of the matching type (`bug`, `idea`, `task`) or a GitHub card, after the same duplicate check and with the ticket in the title, so the pulse still drafts the reply when it closes. `/agent-kevin:helpdesk bug <id>` stays as the shortcut for a bug. A profile's `## Filing bugs` section is now `## Raising`, with a destination per kind; a kind it doesn't name goes where bugs go, and one it sends nowhere is never raised. The pulse lists the tickets to raise with their kind.
- **`database_query` checks a secret column with aggregates only.** The tool's description now says a key, token or password column is checked with `count`, a null-count filter or `min(length(…))`, never selected, grouped by or cut with `substring`, so its values never reach the transcript.

### Fixed
- **SupportCandy status reads reach old tickets.** A ticket list filtered by status read only the 1,000 most recently updated tickets across every status, so older open tickets never reached the pulse, a profile's routines or the queue counts. The list now reads 500 tickets a page, so the same 20 requests reach 10,000.

### Upgrade
- `template/AGENTS.md: mandatory` — Platform's scratch-files paragraph is shorter, says nothing may follow the X's in a `mktemp` template (macOS keeps a suffix literal), and keeps the printed path in a variable inside the same command that uses it. Workflow's verify-before-claim line says a claim about this machine's state is checked in the same turn as the claim.
- `manual: optional` — Xcode pack homes only: `.claude/rules/xcode.md` gains the Ground rules bullet "Set the run destination after every scheme switch" after "Compiles is not verified". Add it by hand; homes without the pack skip this.
- `manual: optional` — in a home with a queue profile (`projects/<slug>/helpdesk.md`), rename its `## Filing bugs` section to `## Raising`, and say there where feature requests and tasks go when they shouldn't follow bugs. The skill no longer reads the old heading.

## [0.8.4] - 2026-10-21

### Added
- **helpdesk skill.** Works a project's support queue through the Helpdesk pack: a pulse (open tickets ranked, patterns, bug candidates, saved to `reports/helpdesk/`), a ticket deep-dive, an account view, a drafted reply left as a private note once approved, and bug filing into a task or a GitHub card (repro, log excerpt, screenshots, never the customer's contact details) after a duplicate check. The pulse closes the loop: it drafts questions from cards waiting on the user and offers replies for cards fixed or declined since the last pulse. Every write (a note, a card, a comment, an answer added to a task) is shown and waits for a yes, and the skill pre-grants no write tool, so the home's permissions decide what it may write.
- **Queue profiles.** A project's `projects/<slug>/helpdesk.md` is its queue's own workflow, written by `/agent-kevin:helpdesk setup <slug>` (or "set up helpdesk for <project>") in six rounds (queue, pulse, bugs, replies, context, routines): its connection, which statuses count as open, reply rules and context, a pulse and bug lifecycle that extend or replace the plugin's defaults, and routines of its own run as `/agent-kevin:helpdesk <routine> <slug>`. Setup checks access first and runs the configure-skills walk when there's no connection it can read. Sync nudges each routine in the profile's `schedule` (`pulse:daily`, `digest:weekly`) when its newest report falls before the current day, week or month; it never runs one. Seed bundles carry a project's profile.
- **Named helpdesk connections.** One SupportCandy site or Pylon workspace per connection. The configure-skills walk asks which project each one is for: a project's connection is named after it and carries that name as a key suffix (`SUPPORTCANDY_URL_<NAME>`, `PYLON_API_TOKEN_<NAME>`), and **No project** is the default on the plain keys. A named connection reads only its own keys and never falls back to the default. `helpdesk_connections` lists what is configured without a credential, every helpdesk tool takes `connection`, and suffixed secrets are masked in logs like the plain ones.
- **More helpdesk reads.** `helpdesk_accounts` lists Pylon accounts; `helpdesk_lookups` lists SupportCandy statuses and categories and Pylon tags, teammates and macros. `helpdesk_tickets` takes `since: 'any'` and, on Pylon, tag, assignee and account filters (a helpdesk that can't apply a filter refuses it), up to 1000 tickets, and says `more` when it stopped at the limit, so the pulse shows the queue as `<N>+ open`. `helpdesk_ticket` adds a Pylon issue's opening body, linked engineering issues and CSAT.
- **Queue counts.** `helpdesk_stats` counts a queue's tickets updated in a window (default 24 hours) by status, tag, unassigned and newly opened: numbers only, never ticket text. `/agent-kevin:helpdesk stats` shows them, and sync's Support block counts every queue: each project's profile, then each connection no profile reads, the no-project default included (Pylon by its open statuses, SupportCandy across every status).
- **App Store pack.** `appstore_reviews` reads any app's App Store reviews by link or id from Apple's public feed (no key, read-only, never replies), learns which country storefronts an app's reviews come from (`.state/appstore/<id>.json`), and reports what it read: a blank feed gives no count, never zero. A queue profile can name its app, and the pulse then reads the reviews since the last complete read and files review bugs without a reply.
- **Stacked PR reviews.** The engineer skill reviews a stack from its edge PR in one report: each finding names its layer, is read at that layer's head and anchored in its diff, and the page badges and filters findings and threads by PR. The summary comment becomes a stack overview (blockers, earlier threads, before/after diagrams, target layout, code skeleton). `--layer` keeps the single-layer review.
- **Paste boxes show the rendered comment.** Every paste box on a PR report opens on its markdown as GitHub renders it (Mermaid drawn), with a Raw toggle; Copy still copies the exact text.

### Changed
- **Helpdesk tickets carry their people.** The requester, assignee and each message's author come back with name and email where the helpdesk gives them, so the agent can find the account and answer by name; nothing written to GitHub carries a customer's name, email or account.
- Multi-step review comments are numbered one-fact steps with `file:line`, an outcome and the fix; the PR report warns on a paste paragraph over 60 words and on a thread given two pastes.

### Fixed
- **A SupportCandy customer's own message came back tagged as an agent's**, and an assignee had no name: the ticket and thread endpoints send ids as numbers or strings, and they were compared as sent. Ids now match either way.

### Upgrade
- `settings: mandatory` — upgrade's baseline reconcile adds `Skill(agent-kevin:helpdesk)` to `permissions.allow` when the home hasn't placed it in allow, ask or deny. Applied automatically.
- `template/AGENTS.md: mandatory` — the reports routing row and the layout tree gain `reports/helpdesk/` and a project's optional `helpdesk.md` queue profile.
- `settings: optional` — only in a home with the Helpdesk pack: add `mcp__plugin_agent-kevin_kevin__helpdesk_connections`, `mcp__plugin_agent-kevin_kevin__helpdesk_accounts`, `mcp__plugin_agent-kevin_kevin__helpdesk_lookups` and `mcp__plugin_agent-kevin_kevin__helpdesk_stats` to `permissions.allow`. Skip and each asks on first use.
- `manual: optional` — to read App Store reviews, run `/agent-kevin:configure-skills` → App Store. To work a project's support queue, run `/agent-kevin:helpdesk setup <slug>` or say "set up helpdesk for <project>".

## [0.8.3] - 2026-10-21

### Added
- **A token per GitHub owner.** A fine-grained token reaches one owner's repos only, so the GitHub tools now pick `GITHUB_TOKEN_<OWNER>` (the owner's login uppercased, hyphens as underscores) for the repo each call names, then the catch-all `GITHUB_TOKEN`, then the operator's `gh auth login`. A `gh` or `git` child sees only the token picked for that call, every `GITHUB_TOKEN*` value is masked in the log, and `github_fast_forward` reports `NOT_CONFIGURED` per repo when its owner has no token.
- **GitHub writes, decided by the token.** `github_issue_create`, `github_issue_comment` (both attach screenshots and videos with `gh` 2.99+), `github_issue_update` (title, description, labels, milestone) and `github_pr_update` (a PR's title or description) run on the same per-owner token as the reads, so the token's permissions decide what they may do: Issues or Pull requests Read and write. Attaching needs the Write role on the repo, not Contents write on the token. Nothing merges, closes, re-runs a workflow or edits someone else's comment.
- **Your own PR's description, applied after you approve it.** The engineer skill's PR playbooks still post nothing, with one exception: the walkthrough's Describe gap and the replies hand-back offer to apply a new title or description to the operator's own PR with `github_pr_update`, after showing the current and proposed text. A teammate's PR is never edited.
- **Helpdesk pack.** `helpdesk_tickets`, `helpdesk_ticket`, `helpdesk_attachment` and `helpdesk_note` read support tickets and leave private draft notes in SupportCandy or Pylon through one ticket shape that never carries a requester's name or email. The note is the only write, so a person sends every reply. `helpdesk_attachment` saves a ticket's log or screenshot to a temp folder outside the home, ready for a GitHub issue.
- **guide skill.** Writes a guide someone else can follow as one self-contained HTML page (a setup walkthrough, onboarding, or a shared workflow and who does what) from a house template with a sidebar, tickable steps, copyable commands, zoomable screenshots and a swimlane.
- **Task tools set more fields.** `task_create` takes `parent` and `checklist`, and `task_update` takes `parent`, `depends_on` and `description` (replacing only the Description section) and answers with the fields it wrote, so a field a stale server dropped shows in the reply.
- **Copy a diagram's Mermaid source** from the expanded diagram view, and a **back-to-top button** on long themed pages (PR reviews, explainers, the roadmap).

### Changed
- **The GitHub pack is one walk.** It grants all fifteen tools, lists the owners behind the configured checkouts with the key name for each, and denies `gh` in the agent's own shell (`Bash(gh)`, `Bash(gh *)`), so GitHub is reached only through the tools, under the token picked for each repo.
- **Codex gets the home's shell denies.** `.codex/rules/kevin.rules` turns each `Bash(…)` entry in `permissions.deny` into a `forbidden` rule beside the prompt rules from `permissions.ask`; Codex applies the strictest match, so `gh pr create` is forbidden too.
- **GitHub errors say what to fix.** A rejected token (expired, revoked or mistyped), a missing permission, a repo the token can't see, and an owner with no key each get a message naming the key and the fix.
- The engineer PR report's before/after card reads "Before and after: what changes when this merges" and names the PR's own base branch instead of always saying `main`, and the proposed description's copy box is labelled "Markdown for the PR body".

### Fixed
- `helpdesk_tickets` with a status filter on SupportCandy filters while paging, so a filtered list no longer comes back short while matching tickets remain in the window.
- **Seed bundles carry a pack's denies.** A home set up from a seed now gets the GitHub pack's `gh` block along with its tools; before, only `allow` and `ask` entries travelled, so the block waited for the GitHub walk to run again.

### Upgrade
- `settings: mandatory` — upgrade's baseline reconcile adds `Skill(agent-kevin:guide)` to `permissions.allow` when the home hasn't placed it in allow, ask or deny. Applied automatically.
- `settings: optional` — only in a home with the GitHub pack: add `mcp__plugin_agent-kevin_kevin__github_issue_create`, `mcp__plugin_agent-kevin_kevin__github_issue_comment`, `mcp__plugin_agent-kevin_kevin__github_issue_update` and `mcp__plugin_agent-kevin_kevin__github_pr_update` to `permissions.allow`, and `Bash(gh)` and `Bash(gh *)` to `permissions.deny`, so GitHub goes through the tools. A home wired for Codex picks the deny up as a `forbidden` rule when the upgrade regenerates its rules. Skip if you want the GitHub pack read-only.
- `manual: optional` — repos under more than one GitHub owner: add one `GITHUB_TOKEN_<OWNER>=` line per owner to `.state/secrets/.env` in your editor (`my-org` → `GITHUB_TOKEN_MY_ORG`), then restart. An existing `GITHUB_TOKEN` keeps working as the catch-all. For writes, give that owner's token Issues and/or Pull requests: Read and write.
- `manual: optional` — to read support tickets, run `/agent-kevin:configure-skills` → Helpdesk (SupportCandy or Pylon).

## [0.8.2] - 2026-10-19

### Fixed
- **Sync commits the `assets/` and `scripts/` home folders.** The brain commit only knew the folders that existed before 0.8.1, so the upgrade that moved the avatar out of `.claude/assets/` left history with the old file deleted and `assets/` untracked. Both folders now commit beside `.claude/`, so a move out of it lands as one rename, and a flow's `.env` under `scripts/` still never enters history. A home that already synced on 0.8.1 gets `assets/` committed on its next sync.

### Upgrade
None — code-only, no bun install or HOME changes.

## [0.8.1] - 2026-10-19

### Added
- **Pin reports and docs to a project.** A project's README can hold a `## Pinned` section, in the
  same line format as `reports/pinned.md`. The project card shows a pin count and a Pinned group,
  the project's focus page gets a Pinned lane, and the reports page lists project pins after the
  global ones, each with its project chip. The brain audit checks these pins for broken and stale
  links, and a seed export ships a README without its Pinned section. Project pins stay out of the
  session context.
- **A renamed agent knows its former names.** IDENTITY.md's `- **Formerly:**` field lists the old
  names, and the session, feedback and inbox compile prompts read them, so dated records under an old
  name are recognised as the agent's own. Seed bundles drop the field.
- **Expand and zoom any diagram on a generated page.** Review and explainer pages give every drawn
  diagram a corner button that opens it full-window, with zoom and drag to pan.

### Changed
- **`.claude/` keeps only what Claude Code reads.** The agent's avatar moves to `assets/`, and the
  home's browser flows move to `scripts/browser/<flow>/` (a flow's `.env` moves with it), under a new
  `scripts/` folder for your own recurring scripts. The `browser_flows` tool reads only the new
  folder, init creates both, and seed bundles carry `assets/` and `scripts/` (never a `.env`), so a
  bundle made before this version no longer imports. The upgrade moves your files (see Upgrade).
- **The rename-agent skill is a script with a dry run.** It shows every line it would change before
  `--apply` writes anything, and `--keep <path>:<line>` protects a line. It records the old name in
  `Formerly`, and `--from` repairs a half-done rename. It leaves the home folder, dated records,
  archives, generated files and non-markdown alone, along with paths like
  `Documents-Agents-<Name>.git`. It no longer needs `rg` or `perl`. Rename-agent and seed export now
  share one rename rule.
- **The engineer PR review page was reworked.** The page checks the PR description's claims, shows
  call and file trees, and lays out findings as scenarios with proof. Comments from people and bots
  share one conversation. Large features get an architecture section. A re-review is a delta by
  default (`--fresh` for a full pass).
- **IDENTITY.md says the agent runs in whichever agent CLI launched it**, not Claude Code, so a
  Codex session isn't told it's a Claude Code plugin.

### Fixed
- **Rename-agent never writes through a symlinked file or folder.** It also writes exactly what the
  dry run showed, IDENTITY.md included.
- **Capture skips the API-request records** that Claude Code 2.1.300 logs in transcripts, so they no
  longer show up as extra turns in `raw/sessions`.
- **find-session leaves logged API requests out of the hit count**, so a term from the injected
  context no longer matches every new session.
- **`/queue` ignores subagent and teammate turns** (Claude Code 2.1.299+). Before, a background
  subagent could leave a queued prompt stuck at "1 queued".
- **`setup_worktree` copies only local files the new checkout doesn't track**, so a tracked
  `.env.example` no longer overwrites the branch's copy.

### Upgrade
- `script: required` — run skills/upgrade/scripts/0.8.1.ts. It moves `.claude/assets/*` to `assets/` and `.claude/browser-flows/<flow>` to `scripts/browser/<flow>` (the flow's `.env` with it), then repoints the `IDENTITY.md` links of the files that moved. An identical copy already at the destination drops the old one; a differing one stays in both places and is reported, and its link is left as it was. OS litter files (`.DS_Store`) neither block a dedupe nor keep an old folder alive. Idempotent.
- `template/AGENTS.md: mandatory` — the folder tree: `.claude/` holds only what Claude Code reads, and `assets/` and `scripts/browser/<flow>/` sit at the home root.
- `template/IDENTITY.md: optional` — the Short Bio says the agent runs inside whichever agent CLI launched it (Claude Code, Codex, or another).
- `manual: none` — the upgrade never reconciles IDENTITY.md's `## Who` block. In that block, change `- **Kind:** AI assistant (Claude Code plugin)` to `- **Kind:** AI assistant (agent CLI plugin)`.
- `manual: none` — only if one of your own flows or scripts names `.claude/browser-flows/` or `.claude/assets/` by path: point it at `scripts/browser/` or `assets/`. Flows that import `lib/flow` need no change.
- `manual: none` — only if you hold a seed bundle exported before 0.8.1: it no longer imports, so re-export it from the source home once that home is upgraded.

## [0.8.0] - 2026-10-15

### Added
- **A seed bundle can carry browser flows.** `.claude/browser-flows/` is a seed root like custom
  skills. No seed root carries a `.env*` file any more (any case, `.envrc` included; `.env.example`
  still travels): one named outright is refused, and one inside a folder is skipped and listed in
  the export result. A flow may not take a built-in flow's name, and the import shows each flow's
  `index.ts` in full, since flows run outside the sandbox.
- **A seed bundle records who it is for.** The export asks whether the bundle is for your own second
  agent or a teammate and writes `audience` to the manifest; an import without one reads as
  `teammate`. For yourself, the review gate leaves your personal rules in, and the import treats them
  as yours once you confirm you sent it; it never rewrites imported identity files without asking.

### Changed
- **Env keys use the shared `AGENT_*` names only.** A `KEVIN_*` key no longer overrides its `AGENT_*`
  twin, and the plugin no longer reads it at all. Several homes can run one plugin, so the agent's
  own spelling could never mean "this agent only", and one set machine-wide pointed every home at the
  same brain. Skills, help text, error hints and the manual template name `AGENT_*` throughout,
  `kevin --home` sets `AGENT_HOME` only, and a browser flow's process gets `AGENT_HOME` only, so a
  flow you wrote that reads `KEVIN_HOME` needs the new name. The upgrade renames what your home
  holds (see Upgrade).
- **Codex wiring writes `AGENT_HOME` only**, reads the home's `AGENT_*` settings only, and removes the
  `KEVIN_*` entries an earlier version wrote.
- **Codex runs the MCP servers Claude Code runs**, not only the pack servers (which, like `xcode`,
  always mirror): every stdio server in `.mcp.json` that `enabledMcpjsonServers` (or
  `enableAllProjectMcpServers`) turns on, minus `disabledMcpjsonServers`. Codex setup owns the table
  of every stdio server named in `.mcp.json`, so one you later disable leaves Codex too, with a note;
  one using `${VAR}` (which Codex would not fill in) stays out, also with a note.
- **The banner shows the agent's own name and emoji** from `IDENTITY.md` instead of `KEVIN 🍌`, in
  the dashboard and init's opening and closing lines.
- **Briefings add the Hijri date only when you keep that calendar.** A faith mention alone (a team
  that is Muslim, say) no longer turns it on, and a learned rule against it wins.
- **A seed bundle exported under a new name is renamed.** `IDENTITY.md` and `SOUL.md` carry the new
  name instead of the source agent's, and an `extras` override of a selected file now ships in its
  place instead of beside it.
- **Carried MCP entries no longer hold the source home's path.** A seed bundle's MCP entries hold a
  `<HOME_DIR>` placeholder that the import fills with the recipient's home.
- **A project-slice seed export pre-ticks the packs** the project's README and tasks show it uses.
- **A blocked task can go back to open** once it's unblocked, and the scan clears a leftover
  `blocked_by` on an open task.

### Removed
- **Support for homes that never ran the 0.7.0 upgrade.** The plugin reads only `.state/`; the
  agent-named `.kevin/` folder and its fallbacks are gone, including Codex's `.kevin/secrets` deny
  and the SessionStart "two data folders" warning, along with the migrations up to 0.7.0 (every
  home is past them; 0.5.3 stays for the roadmap skill), the settings split only 0.6.1 used, and
  the pre-0.4.0 root-manual handling with its "loads twice" banner line. The upgrade also removes
  the guards the old folder left in a home: its secrets deny rules in both settings files and its
  `.gitignore` lines (with the old template's comment above them), so Codex drops its last `.kevin`
  deny too. Init, SessionStart and the upgrade point a home still on `.kevin/` at v0.7.3's
  upgrade.

### Fixed
- **A seed import's confirm is never answered for you.** It is asked on its own with all three
  choices; if the question can't be shown, the import asks in plain text and waits.
- **The finished sync band wraps at whole pieces** in a narrow pane instead of breaking words.
- **Home recovery advice names the file that matters.** A home is the one whose `.state/version.json`
  records this agent's plugin; SessionStart, tool errors, the CLI and upgrade said either marker file
  would do, so restoring only `knowledge.json` looked like a fix and wasn't. An empty `plugin` record
  counts as missing, so the identity check (`home-baseline.ts`) restamps it instead of reporting
  another plugin.
- **Codex setup keeps credentials out of `.codex/config.toml`.** The shell env it copies from the home's
  settings already skipped keys named like a key, token, secret or password; it now also skips
  `AGENT_DB_*` connection strings and credential-, private- or DSN-shaped names, since that file is
  committed with the brain.
- **The upgrade refreshes its template snapshot without `rm -rf`.** It deleted and recopied
  `.state/template-base`, which auto mode refuses in a home that keeps `rm -rf` on its ask list (init's
  default), so the last step of every upgrade needed improvising. It now mirrors the templates in
  place with `rsync --delete` (a plain copy where there is no `rsync`).
- **`google_auth` says where its tokens live:** the home's secrets store (`.state/secrets/google/`).

### Upgrade
- `script: required` — run skills/upgrade/scripts/0.8.0.ts. It renames `KEVIN_*` keys and `$KEVIN_*` references to their `AGENT_*` names in both `.claude/settings.json` and `.claude/settings.local.json` (env keys, and references in any string), `.state/secrets/.env` (key names, line by line, values, order and mode kept) and `.mcp.json` (references and server env keys; the configure-skills home fallback collapses to one `AGENT_HOME` read). Where both spellings are set in the same store, the `KEVIN_*` value wins, since it was the one in effect, and a shadowed secrets line is dropped (the backup keeps it); an `export KEVIN_X=` line, which the plugin's loader never read, is renamed for the server wrappers that source the file but displaces nothing. A `KEVIN_*` setting whose `AGENT_*` twin sits in the secrets file gives way to the secrets value, as every secret does. A file that doesn't parse is named in the error, never quoted. Every file is read before any is written, so one that doesn't parse stops the run with nothing changed. It also removes the pre-0.7.0 `.kevin/` guards: the exact secrets deny rules init and the 0.7.0 move wrote (in either settings file's `permissions` and `sandbox`) and the `.kevin` lines in `.gitignore`, with the old template's comment directly above them; your own rules that mention `.kevin` stay, and a home that still has a `.kevin/` folder keeps all of them. Config backups go under `.state/updates/`, the secrets backup stays in `.state/secrets/`. The report names keys and pruned rules, never values.
- `template/AGENTS.md: mandatory` — the manual names `AGENT_GIT_REPOS` and `$AGENT_CODE_PATH` instead of their `KEVIN_*` spellings, which nothing reads any more.
- `manual: none` — only if `KEVIN_*` keys are set outside the home (`~/.claude/settings.json`, which the upgrade checks and lists, or a shell profile): nothing reads them any more. Delete each, and put a per-home value (code path, repo list, DB connection) into each home's `.claude/settings.local.json` as `AGENT_*`. Only a value every home should share (timezone, log level) is renamed in place. A `KEVIN_HOME` pin (sessions started outside the home) becomes `AGENT_HOME` there only on a machine with a single agent home; otherwise delete it.
- `manual: none` — restart Claude Code (and Codex) after the upgrade: a running session keeps the old names until it relaunches.
- `manual: none` — only for a home whose data is still in `.kevin/` (it never ran the 0.7.0 upgrade): this version no longer reads or moves that folder. Install v0.7.3 (a local checkout at tag `v0.7.3`), run `/agent-kevin:upgrade` there, then update to this version.

## [0.7.3] - 2026-10-14

### Added
- **`/reports`** (Claude Code mod) shows the reports this conversation produced in a row above the
  prompt until you press Dismiss: every report a skill saved (a subagent's included), and any file
  the conversation wrote or edited that is a deliverable, meaning anything under `reports/`, a page
  or document inside a project folder (not its README or tasks), and the home's `roadmap.html`. A
  report with an HTML page shows the page. The row lists them newest first, scrolls once it outgrows
  the space above the prompt, and follows new ones while open, and Claude gets the full list. `/reports attach <path> …` adds files by hand, several at
  once, with a path that has spaces in quotes. A resumed conversation keeps its list, and the
  dashboard's Mods tab and cheatsheet list the command.
- **`/session`** (Claude Code mod) shows this conversation's session id in a row above the prompt,
  with a Copy button and a Dismiss button. Nothing reaches the clipboard until you press Copy, and a
  `/clear` takes the row down because the next conversation has another id.

### Changed
- **`/today` shows its agenda in a row above the prompt** with a Dismiss button, the same way
  sync and `/queue` draw. It used to print only its one-line summary in the terminal.

### Removed
- **The manual no longer asks for bare markdown paths in chat.** The rule worked around a terminal
  that previewed a Cmd-clicked markdown path only without a `:line` or a hyperlink. cmux 0.65.1 opens
  `notes.md:12` in its Markdown viewer, so markdown files take the usual `file_path:line_number` form.

### Upgrade
- `template/AGENTS.md: mandatory` — the Platform section drops the "Paths in chat are bare when the terminal opens them" paragraph.

## [0.7.2] - 2026-10-12

### Added
- **`/queue <prompt>`** (Claude Code mod) holds a prompt until the current task ends, then sends
  it as its own turn, one per turn and in order, never mid-task. A count above the prompt shows
  what is waiting, and `/queue clear` drops the rest. A turn you stop with Esc, or one that fails,
  pauses the queue until a turn ends normally. The dashboard's Mods tab and the cheatsheet
  list it.
- **PR reviews and replies end in one page** with a Copy button on every finding, question, nit,
  bot reply, thread reply and commit message, plus a file map showing each file's comments. A
  short markdown card sits beside it for the index, dashboard and other skills. A validator
  (`skills/engineer/scripts/pr-report.ts`) checks the data before anything is saved: thread links
  must be the comment's own GitHub URL, reading-guide, decision and finding anchors must name listed
  files, a misspelled key in any row is an error, and the verdict must agree with the findings.
- **Two new review lanes.** `generated-code` covers what fast, often model-written code gets wrong
  while still compiling: invented APIs, reinvented helpers, partial migrations, tests bent to pass.
  `performance` covers round trips, unbounded work, missing indexes and timeouts. TypeScript
  specifics move to a `langs/typescript.md` addendum, so the lanes read the same in any language.
- **Reviews add a reading guide and a case against merging.** A review now names the hunks worth
  reading and what to skim, shows behavior before and after, and makes the strongest argument
  against merging. Every review-bot comment is verified and gets a disposition.
- `github_pr_view` returns `headRefOid`, `isCrossRepository` and `mergeCommit`, so a review can
  confirm it checked out the PR's head, fetch a fork's head instead of reading a branch with the
  same name in the base repo, and find a merged PR's commit.
- **Every generated page has an Auto / Light / Dark switch, Auto by default.** The dashboard,
  focus pages, PR pages, roadmap, tax dashboard, itinerary and explainers share one block
  (`mcp-server/src/shared/theme.ts`) that sets the theme before first paint, follows the system
  live on Auto, and remembers one choice per browser that every page reads. The dashboard and focus pages gain a light
  palette and the itinerary a dark one; an itinerary always prints light. A `roadmap.html` or
  itinerary built earlier keeps its old look until the roadmap or itinerary skill renders it again.
- **Explainers have a template.** The engineer skill writes only an explainer's body; a script
  (`skills/engineer/scripts/explainer.ts`) checks it, parses its diagrams, and wraps it in a page
  with a sticky top bar, a contents dropdown that tracks the section in view, and the theme switch.
- **`/done` suggests the task to close.** After `/done `, a letter of the id or a word of the title
  lists the open and active tasks that match, id matches first and most urgent first, so closing
  one no longer means remembering its id.
- **A new folder points at setup.** In a folder that isn't an agent home yet, a row above the
  prompt has a Set up button that runs init, and init is the Tab suggestion. A folder in or under
  a home, or one holding a `SOUL.md`, never shows it.
- **Pin reports to the dashboard sidebar.** List them in `reports/pinned.md`, one markdown link
  per line with an optional emoji before it (`- 🗺️ [Roadmap](plans/roadmap.html)`), relative to
  `reports/`; `*` bullets, `%20`, `#anchors` and `<…>` targets read too. The dashboard draws them
  as a Pinned group under Surfaces, each opening in a new tab; a listed file that is gone, or one
  outside the home, drops out.
- **Pins and surfaces reach the agent.** Every session's context lists the pinned reports. The
  self-review brain pass asks about a pin whose file is gone (fix the link or unpin), and about a
  pin, the roadmap or a project dashboard unchanged for 60 days (refresh, still accurate, unpin, or
  promote a pin into the brain). Sync's 🧹 Brain line counts both. "Pin this report" goes through
  the dashboard skill.
- **The Reports page leads with the pins** as their own group, with a 📌 Pinned filter chip beside
  the categories.
- **Pick a project's color.** `hue:` (0–359) in a project README's frontmatter colors its card,
  chips and focus rows; a project without one keeps the color its name hashes to.

### Changed
- **A project card shows its Roadmap and Focus links on its first line**, so they're visible
  without expanding it, and a roadmap is a 🗺️ everywhere on the dashboard (it was 🧭).
- **The Brain page's Injected at SessionStart list** leads with today's date and shows each
  entry's note (how many pins, snapshots or reports), and the SessionStart hook's description
  names the pinned reports and the home-check warnings it can add.
- The README installs the plugin with one command, `/plugin install agent-kevin --marketplace <repo>`,
  which adds the marketplace when it's missing.
- **Sync's `sync_stats` tool sits in the prompt's tool list** instead of behind tool search, so
  sync calls it directly rather than looking it up first.
- Claude Code 2.1.293 or newer is required (mod autocomplete and tools kept out of tool search):
  init and upgrade stop below it with `claude update`, and the SessionStart banner warns until the
  host is updated.
- **Review depth follows risk.** A PR under 300 changed lines with no risk-triaged file runs
  compact: three agents carrying three lanes each, and at most two verifiers. `--full` overrides.
  The local checks find the repo's own gates in its docs and manifests and run them with its own
  tool. Where a repo's written conventions say nothing, a change is held to what its neighboring
  code already does.
- Lanes carry slugs, and findings are routed by evidence. A real defect that was already there
  before the PR is reported under Noticed instead of being dropped.
- PR replies answer every part of a reviewer's question, quote each comment's opening words so a
  GitHub search finds the thread, and mark each thread To post, Posted or Follow-up on a re-run.
  A stack of PRs gets one report.
- The engineer skill may call `github_pr_checks` and `github_run_log` without a prompt, to read a
  PR's CI.
- The mermaid validator exports `parseMermaid`, and its failure line now carries Mermaid's
  "Expecting …" hint.
- **The Xcode pack stops asking before `RunCodeSnippet`.** Snippets run Swift outside the
  sandbox, but so do the test and run tools on code the agent can already write, so the prompt
  removed no capability. It fired whenever a snippet checked a value during debugging.
  `InvokeDebuggerCommand` stays gated, since LLDB can run shell commands directly.
- **The `guard` hook enforces the two shell rules a written rule couldn't hold.** Under Claude
  Code a `cd` in one command carries over to every later one, so in a session launched in the
  agent home the hook refuses a top-level `cd` that would leave it. It also refuses every command
  from a session that has already left, until one returns. Codex starts each command in the workspace,
  so this check runs on Claude Code only. On both hosts it refuses a pattern in the folder name
  right under the shared temp dir (`ls -d $TMPDIR/mmd-*`), which can pick another session's
  scratch, and a hand-picked `$TMPDIR/<name>` used anywhere but in `mktemp`. `git -C`, absolute
  paths and a subshell `( cd <repo> && … )` pass. The PR playbook's gate commands run their `cd`
  in a subshell now, and the release skill names the repo with `git -C` in every step. On Windows the guard reads Git Bash paths (`/c/Users/…`, `/cygdrive/c/…`) and
  drive-letter paths as the same place, and checks Codex's PowerShell commands only for a
  home-tree write from the wrong folder.

### Removed
- The markdown review and replies templates. The page and its card replace them, and
  `references/pr/report.md` holds every field's rule.

### Fixed
- A post-merge PR audit can find its code after the head branch is deleted: it reads the PR's
  merge commit from `github_pr_view` and uses that commit's first parent as the base.
- `browser_screenshot` and `browser_pdf` of an explainer or PR page capture its diagrams drawn,
  not their Mermaid source. The page marks when drawing has finished, including when a diagram
  fails or the library can't load, and the capture waits for that mark.
- On a busy day, the session context's list of today's reports is cut at the last whole entry,
  not partway through a link.
- **The sync band follows a sync handed to a background agent.** It used to show the run done
  once the main turn ended, with its counters stuck at the start, save that short run to the
  history behind the average, and answer `sync_stats` in the hand-back turn with "No sync is
  running". The run now belongs to the loop that loaded sync, joined by every agent spawned from
  it: their tool calls move the rail and counters, and the run ends with the loading loop's turn
  once none of its agents is still working, so the hand-back turn stays part of it.

### Upgrade
- `script: required` — run skills/upgrade/scripts/0.7.2.ts. It drops `mcp__xcode__RunCodeSnippet` from `permissions.ask` in `.claude/settings.json` (the settings merge only adds, so the removal lives here); `mcp__xcode__InvokeDebuggerCommand` and every other entry keep their place. A home without the Xcode pack is untouched.
- `template/AGENTS.md: mandatory` — Platform's shell-commands paragraph replaces "every git or build call starts with its own absolute `cd`" with `git -C`, absolute paths or a subshell `cd`, and keeps the absolute `cd` for commands handed to the operator. The scratch-files paragraph gains the exact-printed-name rule and names the `guard` hook, and its `mktemp` form gains a `/tmp` fallback for a Git Bash without `TMPDIR`. Context Loading's dynamic list gains today's and pinned reports.
- `template/CLAUDE.md: mandatory` — the bridge's SessionStart sentence names today's and pinned reports.

## [0.7.1] - 2026-10-08

### Added
- **Notices.** Upgrade and sync nudges come from one place every surface reads. Each carries a
  level (hint, nudge, alert) that rises with age and the command that acts on it; upgrade leads.
  `kevin notices` prints them, and `kevin notices record` logs an act or a snooze in
  `.state/notices.json` (hidden for the day; an unpinned notice drops a level after five snoozes
  in a row).
  - **Above the prompt (Claude Code terminal).** A mod draws the top notice as a row with its
    facts, the average sync time and two buttons: run it now, or Tomorrow. It is also the Tab
    suggestion, and an alert raises a toast. The row stays aside while the command it started runs.
  - **In the banner** everywhere else (VS Code, desktop, `-p`, Codex), color-coded by level, and in
    the terminal too until the row proves it draws.
- **Sync offers a north-star roadmap** at its close while the home has no `roadmap.html`. A
  HOME-root roadmap build asks for the north star and writes it into the Yearly Goals header, and
  the year playbook reads it from the roadmap instead of asking each quarter.
- **The dashboard's Capabilities page has a Mods tab**: each mod feature with the commands and
  tools it adds, the Claude Code version mods need, and whether the module has loaded on this
  machine (the notices row's session-start stamp). The commands register from the same catalog
  the tab reads, `mods/shared/catalog.ts`. The cheatsheet gains `/capture <text>`.

### Changed
- The plugin's name, its MCP server key and the CLI path are derived from the manifest instead of
  spelled across the code. The values are unchanged, so homes, settings and transcripts see the
  same text.

### Fixed
- The status line reads on a light terminal. The model name, folder and branch were drawn in white
  and bright hues; a light Claude Code theme, or the macOS light appearance when the theme is
  `auto`, now switches them to colours that read there. Dark output is unchanged.

### Upgrade
None — code-only, no bun install or HOME changes.

## [0.7.0] - 2026-10-08

### Added
- **Mods (Claude Code).** The plugin loads one hooks module, `mods/hooks/register.ts`, beside its
  command hooks. Codex runs as before.
  - **Commands with no Claude turn:** `/capture` and `/lesson` write to the inbox and the feedback
    log, `/done` closes a task, and `/today` shows overdue and due-today work, the Hijri date and the
    last sync.
  - **Repo manuals attach on first touch.** The first read, write or shell command in a granted code
    folder attaches that repo's `CLAUDE.md` (with its imports) or `AGENTS.md` to the tool result,
    once, and again after a compaction or `/clear`. `/manuals` lists what is attached.
  - **Sync shows its progress** above the prompt (status, its twelve steps, counters for what it is
    clearing), and a `sync_stats` tool hands the report counted numbers instead of a tally.

### Changed
- **The data dir is `.state/` for every agent.** `.kevin/` becomes `.state/`, and its
  `version.json` records which plugin owns it; a `.state/` that records another plugin, or none, is
  not this agent's home and its secrets are never read. A home still on `.kevin/` keeps working
  until the upgrade moves it.
- **The `.state/secrets` guard is always written** to the home's own settings, including homes whose
  user settings carry their own deny list. The Codex profile denies both `.state/secrets` and the
  old `.kevin/secrets`.
- **init stops in a home still on `.kevin/`** and points to the upgrade, instead of scaffolding a
  second data dir beside it.
- **Session start flags a `.kevin/` that reappears beside `.state/`**: a session still on the older
  plugin wrote there after the move, so the agent asks you to compare it and carry anything newer
  into `.state/`.
- **Sync's closing "what next" question takes several picks.** Act now works through them in order;
  Queue files or threads a task for each.
- Claude Code 2.1.287 or newer is required (mods): init and upgrade stop below it with
  `claude update`, and the SessionStart banner warns until the host is updated.

### Fixed
- The log file is resolved on each write, so a long-running server stops writing to a folder that
  has moved.
- Knowledge lint resolves links to archived tasks. The flywheel moves closed tasks to
  `tasks/archive/`, and every link to one was reported as broken.

### Upgrade
- `script: required` — run skills/upgrade/scripts/0.7.0.ts (records the plugin in `.kevin/version.json`, adds the `.state/secrets` deny rules and the `.state/` gitignore rules, renames `.kevin/` to `.state/`, and repoints every `.kevin/` path in the machine-local config, `.mcp.json` and `.claude/settings.local.json` (a pack server's secrets file, or an env value, hook or permission you added); every rewritten file is backed up under `.state/updates/`, and a re-run finishes a move that stopped partway).
- `template/AGENTS.md: mandatory` — the Knowledge Structure tree names `.state/`.
- `template/.gitignore: mandatory` — the runtime rules name `.state/`; the 0.7.0 script and the baseline reconcile apply it.
- `manual: none` — close this agent's other sessions (Claude Code and Codex) before running the upgrade, and restart once it finishes. A session started on the older plugin stops recognising the home once the folder moves: its tools refuse and its transcript is not captured.
- `manual: none` — only if you created a `.state/` folder by hand: the move stops without changing anything. Move what you put there into `.kevin/`, move `.state/` aside, and run the upgrade again.

## [0.6.5] - 2026-10-07

### Added
- **A home records which plugin owns it.** `.kevin/version.json` now carries `"plugin": "agent-kevin"`,
  and the runtime's home walk-up and logger refuse a data dir recorded for another plugin, so two
  agents can share a folder name without one resolving into the other's home. A baseline with no
  record still matches until init or upgrade stamps it.
- **Paths in chat stay bare** in the manual template's Platform section: some terminals (cmux among
  them) preview a Cmd-clicked markdown path only when it carries no `:line` and no hyperlink.

### Changed
- **Skills spot an agent home by its data dir, not `SOUL.md`.** Upgrade and self-review now look for
  `.kevin/version.json` or `.kevin/knowledge.json`, the runtime's own check since v0.3.28; every
  agent's home has a `SOUL.md`, so the old check matched a sibling's. The manual template drops
  "where SOUL.md lives" from the launch-from-the-home rule.

### Removed
- **The runtime-dir override** (`AGENT_RUNTIME_DIR` / `KEVIN_RUNTIME_DIR`). Only the server honoured
  it: skill text, init's secrets deny rules and the Codex wiring all assume `.kevin`, so a renamed
  folder left the secrets store outside every sandbox rule. The folder name is now fixed.

### Fixed
- A deferred-capture test could read `index.json` instead of the day file when APFS listed it first.

### Upgrade
- `template/AGENTS.md: mandatory` — the Platform section drops "where SOUL.md lives" from the launch rule and gains the bare-paths-in-chat rule.
- `manual: none` — only if this home set `KEVIN_RUNTIME_DIR` or `AGENT_RUNTIME_DIR`: rename its data folder back to `.kevin` and delete the variable from settings, or the home is no longer recognised. Homes that never set it need nothing; the upgrade's `home-baseline.ts` run adds the `plugin` record on its own.

## [0.6.4] - 2026-10-07

### Added
- **A monthly brain pass in self-review.** An inventory script finds decay: tasks untouched for 30
  days, projects quiet for 60, memory lines that went false, archived decisions from the last 45
  days that no permanent article holds, articles current state has outrun, and captures older than
  a month. The pass asks about each, four questions at a time with the evidence and a recommendation
  first, and applies every batch before the next. A Keep stays quiet for 90 days while the item is
  unchanged. A bare `/self-review` runs the brain pass, then the rules pass.
- **Sync offers the self-review when it's due**, first and on its own: Run it now, Tomorrow, or Skip
  this month. The brain pass comes due every 30 days; skips are counted. Every sync also prints a
  🧹 Brain line with the inventory's counts, so decay stays visible between reviews.
- **The flywheel reads sessions.** It catches up on the daily memory written since its last report,
  adds a thread note to tasks the sessions moved, and lists up to five work streams no task tracks.
  An overdue task untouched since the last run is **stalled** and gets one decision (Push a week,
  Park, Blocked, Cancel) instead of another "still unchanged" note.
- `/self-review help` prints the menu.
- **Upgrade brings the plugin itself current first.** A git-checkout install is fast-forwarded
  through `github_fast_forward` before versions are read; a stale cache install is refreshed
  through the CLI's plugin commands when it has them.
- **init writes a concrete memory-index scaffold**, with the sections compile keeps, in its order.

### Changed
- **Sync runs the flywheel skill's own protocol** with five sync-specific overrides, instead of a
  copy that had drifted. It still reads tasks live through `task_query`.
- **Sync refreshes Open Questions whenever it compiles.** Only a manual compile used to, so a gap
  that had been filled could stay flagged for months.
- **Self-review is two playbooks**: brain (the data) and rules (the prompt surface).
- **Playbooks get the plugin root from their skill.** Claude Code fills `${CLAUDE_PLUGIN_ROOT}` only
  inline in a loaded `SKILL.md`, not in files read later; the skill states the path and playbooks
  write `<plugin root>`. Codex resolves it from the skill's base directory.
- **Codex homes default to GPT-6.1 Sol** (high) instead of Astra.
- **Project create and archive edit the knowledge index's Projects row themselves.** Nothing
  regenerates that table; the playbooks had promised a sync that never existed.
- Sync's Code and Dashboard lines use 💻 and 📊, which keep their space in a terminal.
- **Shipped defaults come from the operator.** The yearly plan weighs the personal commitments they
  named, sync's news clusters follow their signal topics, and the monthly goals line points at
  `/goals month`.
- **The manual gains two workflow rules:** once a branch has a PR, corrections land as forward
  commits on it; and the home's git history is its own, committed by sync only while local-only.
- init no longer suggests pinning the home in the shell rc: a pin is for a single-home machine.
- **SOUL asks for complete answers.** Every question the operator asked gets answered, each by name,
  and a decision handed back says in plain words what it means and what Kevin would pick.

### Fixed
- Database passwords pasted raw with URL-reserved characters connect.
- The briefings' "files touched today" check works where `find` is bfs, and the evening wrap before
  3am reads the day it is wrapping.
- The morning brief signs with the agent's own emoji, and the CLI's `compile status` help lists
  the inbox, the queue's real third kind.
- Upgrade's steps run 4, 5, 6 again (the baseline stamp had lost its heading), init's storage
  question renders as one quote, and the dashboard's empty-changelog hint names the running plugin.

### Upgrade
- `template/SOUL.md: optional` — Writing Style gains one line: answer every question asked, by name, and hand decisions back with a plain explanation and a recommendation.
- `template/AGENTS.md: mandatory` — the Workflow section gains the PR forward-commit rule, the knowledge lifecycle gains the home-history line, and the tree lists `.obsidian/`.
- `script: required` — run skills/upgrade/scripts/0.6.4.ts (a Codex home still on `gpt-6-astra` moves to `gpt-6.1-sol`, once; any other model, and homes without Codex, are left as they are).
- `manual: none` — sync will offer a monthly self-review (brain, then rules); a home never reviewed is offered one once its oldest session is a month old.

## [0.6.3] - 2026-10-02

### Added
- **The session banner nudges a sync.** Once three days pass since the last sync, the banner adds
  one line: run `/agent-kevin:sync`, with how long it has been ("none on record" before the first
  one). It stays quiet during the welcome after init.

### Changed
- **Sync records itself.** Sync's final dashboard call passes `sync: true`, which stamps the run
  before rendering. The dashboard's last-sync age reads that stamp instead of guessing from the
  newest briefing, so a standalone brief or standup no longer resets it, and a sync that ran no
  briefing still counts.
- **Adversarial review on code leads with design.** The reviewer applies the engineer skill's
  principles first and tags each finding as design, defect or edge case. Verify fixes security,
  data safety, defects and design simplifications. An edge case whose only fix is another guard is
  deferred, listed with the reason, and offered to you.

### Fixed
- Plan-spec specs are written through `report_write`, so they appear in `reports/index.md` and the
  next session sees them. Outside an agent home they still go to the plans directory.

### Upgrade
- `template/IDENTITY.md: optional` — the Operational Pattern "Review loop" line now says the agent fixes what's worth the code, simpler shape first, and offers the edge cases it deferred.

## [0.6.2] - 2026-10-01

### Added
- **The media skill.** Hand over a local recording (a screen recording, a ticket's video, a
  meeting, a voice memo) and get the transcript with timestamps, screenshots, a summary, a bug's
  repro steps, or a note saved to the brain. Its five playbooks are summarize, ticket, transcribe,
  screenshots and remember. A link can't be fetched, so download the file and give its path.
- **`media_transcribe` tool.** It transcribes speech on the device, with nothing uploaded, using
  Apple's SpeechAnalyzer through `yap` (macOS 26+). It writes `transcript.md` and `transcript.json`
  to a new folder under `reports/captures`.
- **`video_frames` grabs chosen moments.** A new `at` mode takes one frame at each second you give
  it, so frames can follow the narration ("the total is wrong at 1:13"). A `dir` option puts the
  frames beside the recording's transcript in the same capture folder.
- **Focus organize.** "I'm overwhelmed" now starts with a brain dump in plain chat and sorts it
  against your tasks (tracked, new, waiting on someone, worry or note). It asks only about real
  gaps (overdue tasks, missing week goals, milestones with no task), then cuts the day to three.
  Worries go to the inbox and a card lists what was parked.
- **Compile reads folders, zips and PDFs from the inbox.** Folders are walked at any depth and
  archived under the same path. A zip is unpacked first. A PDF, an image, or a text file over
  30KB is given to the model by path to read in parts, instead of being pasted in as bytes or cut
  off.

### Changed
- **Standup replies with a glance card.** The chat reply is one short card to read mid-standup,
  and the full update stays in the saved report.
- **Skill output signs with the agent's own emoji** from `IDENTITY.md`, not the default 🍌. This
  covers the briefings, the standup card and the worktree summary.

### Fixed
- Browser captures and video frames stay inside `reports/captures`. Before this, a `name` like
  `../../x` could write outside it.
- Frame labels round down, so 59.6s prints as `00:59`, not `00:60`.

### Upgrade
- `settings: mandatory` — upgrade's baseline reconcile adds `mcp__plugin_agent-kevin_kevin__media_transcribe` and `Skill(agent-kevin:media)` to `permissions.allow` when the home hasn't placed them in allow, ask or deny. Applied automatically.
- `manual: optional` — to transcribe recordings, install `yap` from a normal terminal: `brew install yap` (macOS 26+). For screenshots from video, also install `ffmpeg` (`brew install ffmpeg`). Without them, the media tools say what is missing and stop.

## [0.6.1] - 2026-09-30

### Added
- **Daily goals.** `/goals day` sets one to three outcomes for today and the evening wrap scores
  them. They land in a `## Daily Goals — <date>` block in TASKS.md, get their own card on the
  dashboard's Goals tab, and head the Today lane of the Focus view; `focus_write` returns them as
  `dayGoals` so focus plan reads the same list.
- **A welcome after init.** Init can't ask what to do first, since the plugin only loads after a
  relaunch. It now leaves a welcome pending, and the first session after it opens with one
  question, where to start: the roadmap always first, then documents, packs and the morning brief
  when they apply. A re-init never welcomes twice.
- **Postman adapter for api-collections.** Postman v12's Native Git mode reads v3 YAML
  collections from disk, so drafting works like Bruno: Kevin writes the request file, you click
  Send in Local View. Secrets are `{{vault:KEY}}` references, flows chain in the Runner, and
  nothing pushes to Postman Cloud. An existing collection's format picks the adapter.
- **Plans reviewed against their code.** adversarial-review resolves a plan's grounding (the repos
  and commits it was written against), hands them to the reviewer read-only, flags drift and work
  already built elsewhere, and asks plan-shaped questions. Design findings on a plan go to you as
  questions. plan-spec records the grounding and offers the review before anyone builds.

### Changed
- **Fifteen skills fold into five playbook skills**, the same shape as engineer, focus and tax, so
  there are five names to remember instead of fifteen:
  - `briefing`: morning, evening, pulse
  - `goals`: day (new), week, month, year. `/goals week` sets the week (or scores it on a Friday),
    and `/goals week interview` is the old weekly-goals interview. Focus's week playbook moves here,
    since goals are outcomes and focus plans the tasks.
  - `seo`: audit, console, speed, serp, rank (wordpress-rest stays its own skill)
  - `seed`: export, import
  - `project`: create, archive

  A bare `/briefing` picks the morning or evening brief the way sync does, a bare `/goals` runs
  whichever horizon is due (the day when none is), a bare `/seo` runs the audit, and a bare `/seed`
  or `/project` prints its menu. Report slugs are unchanged, so sync and the dashboard still find
  earlier runs. Skill tiles on the dashboard list a router's playbooks as chips.
- Sync's closing interview can run a due goals cadence itself (the week as `goals week interview`)
  instead of only printing the command, and sync reads the old cadence keys until the upgrade
  moves them.
- Every skill is model-invocable except init, release and rename-agent, which also ship
  `agents/openai.yaml` so Codex doesn't pick them on its own. Init grants every skill but init
  and rename-agent.
- **Machine-bound settings live in `settings.local.json`.** A home's `settings.json` travels
  (history commits it, a synced folder copies it, a seed carries its grants), but init wrote
  entries into it that only work on one machine: the status line command, this plugin's enable
  entry, and the code-root and custom-folder grants. Those now go to `settings.local.json`, which
  Claude Code merges over `settings.json`; policy stays shared.
  The baseline check, registration check and stale status-line check all read the merged view.
- The roadmap skill reads init's goals draft (`knowledge/concepts/roadmap-draft.md`) for the north
  star and milestones, confirms the frame it implies instead of asking from scratch, and marks the
  draft superseded once `roadmap.html` exists.
- Codex homes default to `gpt-6-astra` at `high` reasoning: init and upgrade fill the home-level
  `model` and `model_reasoning_effort` keys when they're missing and keep any value already set.
  The user-global paste note no longer suggests a reasoning effort.
- Marketplace add commands take `owner/repo`; the `github:` prefix Claude Code doesn't recognise
  is gone from the README and upgrade's registration hint.

### Removed
- The `morning-briefing`, `evening-briefing`, `quick-pulse`, `weekly-goals`, `monthly-goals`,
  `yearly-goals`, `google-search-audit`, `google-search-console`, `google-page-speed`, `serpapi`,
  `open-page-rank`, `seed-export`, `seed-import`, `create-project` and `archive-project` skills,
  now playbooks of the five above. `/focus week` moves to `/goals week`.
- Init no longer writes an absolute `plansDirectory` (Claude Code ignores a plans folder outside
  the project) or any `Write()` folder rule (Claude Code never consults one).

### Fixed
- Custom-folder rules an older init wrote as `Read(/abs/**)` never matched, since a single leading
  slash is project-relative in a permission rule. Init writes `//abs` for Read and Edit rules.
- An evening wrap after midnight covers the day being wrapped from 00:00 until now, reading both
  dates' sessions and closures, where it used to see only what happened after midnight; its Hijri
  date names the same day.
- The session radar dropped a session that was only slash commands (an `/upgrade`, a `/release`),
  because a command turn didn't count as the operator's words. It now reads as `/name args`.

### Upgrade
- `script: required` — run skills/upgrade/scripts/0.6.1.ts. It rewrites each retired `Skill(agent-kevin:<old>)` rule in `permissions.allow`, `ask` or `deny` of `.claude/settings.json` and `.claude/settings.local.json` to its successor's, in the same list (a gated `seed-import` still gates `seed`; a prefix rule like `Skill(agent-kevin:seed- *)` keeps working through exact successor rules). It moves the `weekly-goals` / `monthly-goals` / `yearly-goals` cadence keys to `goals-week` / `goals-month` / `goals-year`, rewords the goals placeholders in TASKS.md and adds a Daily Goals one, and reports (never edits) files you own that still name an old command. It rewrites `.claude/settings.json`, `.claude/settings.local.json`, `.kevin/cadence.json` and `projects/TASKS.md`; back those up first. It also moves this machine's entries (a status line that runs a program by absolute path, this plugin's `enabledPlugins` entry and the marketplace it names, absolute folder grants) from `settings.json` to `settings.local.json`; other plugins and marketplaces stay shared, writing the local file first, and rewrites `Read(/abs/**)` folder rules to `//abs`. Settings files keep their layout.
- `settings: mandatory` — upgrade's baseline reconcile adds the new skills' grants (`Skill(agent-kevin:briefing)`, `Skill(agent-kevin:goals)`, `Skill(agent-kevin:seo)`, `Skill(agent-kevin:seed)`, `Skill(agent-kevin:project)`) and the grants for skills that became model-invocable, when the home hasn't placed them in allow, ask or deny. Applied automatically.
- `settings: mandatory` — the Codex wiring regenerates and fills a missing home-level `model` / `model_reasoning_effort` in `.codex/config.toml` with `gpt-6-astra` / `high`; a value already set is kept. Applied automatically for homes wired to Codex.
- `template/AGENTS.md: mandatory` — the tree comments for `.claude/settings.json` (shared policy) and `.claude/settings.local.json` (this machine's plugin registration, status line, folder grants, env) follow the new ownership split.
- `manual: none` — the fifteen retired commands are now playbooks: `/briefing morning|evening|pulse`, `/goals week|month|year` (weekly-goals' interview is `/goals week interview`), `/seo audit|console|speed|serp|rank`, `/seed export|import`, `/project create|archive`, and `/focus week` is `/goals week`. Plain asks ("brief me", "plan the week", "run the SEO audit") route on their own. A schedule or script outside the home that runs an old command (`~/.claude/scheduled_tasks.json`, a cron or launchd job) needs the new one; the script only sees files inside the home.

## [0.6.0] - 2026-09-29

### Added
- **Init asks about your world.** A new step (5d) asks what you're working on, what should land
  this year, and which company the agent works for, the same ground the website wizard covers.
  Each project gets its folder and README, goals land in `knowledge/concepts/roadmap-draft.md`
  for the roadmap skill, and the company in `knowledge/concepts/company-profile.md` with its
  website read. It then opens the documents drop: the LinkedIn profile saved as PDF (LinkedIn
  blocks automated reads, so this is how career history arrives), a résumé, company one-pagers.
  Init reads what's about you and the company into the knowledge base straight away, and the
  first compile absorbs the rest. A seed bundle skips the first three questions, since it
  carries them.
- **Python runs through uv.** The manual's Toolchain section routes Python scripts through
  `uv run --with <packages>`, a throwaway environment per run, so no system or Homebrew Python
  gets packages. Init always writes a pip guard to `permissions.deny` (even when the operator's
  global deny list is their own) and uv's cache folder and the PyPI hosts to the sandbox, since
  sandbox lists merge across settings files; without them every `uv run` fails on its cache.
  Init's prerequisite check notes a missing `uv`.
- **Focus playbooks.** The focus skill is a router: refresh, add, plan, week, standup,
  where-am-i, triage, checkpoint and backfill each have a playbook, and `/focus help` prints the
  menu. Plan reads the newest radar, so work already started ranks above anything new.

### Changed
- **Focus is the day.** The dashboard's Today tab opens on a Focus view: today's three,
  carried-over work, the week and month lanes, and the roadmap in flight, drawn with the focus
  page's own lanes and timeline. The home `focus.html` page is retired (project focus pages stay):
  `focus_write` without a project re-renders the dashboard, returns `dashboard.html`, and
  `dashboard.html` embeds the same `focus-data` JSON block. Plan folds into Tasks → Agenda as In
  flight, soonest deadline first, plus "Due …" groups labelled by deadline.
- **`standup` and `where-am-i` fold into the `focus` skill** as playbooks, next to new `week`,
  `triage` and `checkpoint` playbooks: `/focus standup`, `/focus where-am-i`, `/focus week`.
  Weekly goals are applied through focus's week playbook, so the week's tasks and the Weekly
  Goals block are one list. Dashboard, sync, morning brief and find-session point at the
  playbooks.
- Every dashboard page header carries stat tiles, compacted to one line with a caption; each
  tile (by click or keyboard) scrolls to the section it counts, and a zero tile does not link.
  Overdue and due captions say how late in days.
- Sync pulls the focus queue on every run, and `report_write` re-renders the dashboard so a new
  report shows up without a refresh.
- The MCP server moves from `@modelcontextprotocol/sdk` 1.29 to the v2 TypeScript SDK
  (`@modelcontextprotocol/server` 2.2), still on stdio. The SDK pulls in two dependencies
  instead of seventeen (no express, hono or jose). The same tools, with schemas in the 2020-12 dialect
  and one-line validation errors.
- The Codex starter prompts offer `$focus` instead of `$standup`.
- Claude Code's Haiku tier (its small background calls) runs on Sonnet 5.5: init always writes
  `env.ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-sonnet-5-5"` to project settings, and every upgrade
  sets it when a home has none or still carries the old `claude-sonnet-4-6`. A home's own choice
  of another model is kept.
- Claude Code 2.1.284 or newer is required, the release Sonnet 5.5 behind the Haiku-tier remap was
  verified on: init and upgrade stop below it with `claude update`, and the SessionStart banner
  warns until the host is updated.
- Upgrade re-checks init's core deny list and sandbox block on every run, with the same test init
  uses: when the user settings carry no deny list, or neither they nor the project turn the
  sandbox on, the home gets the baseline back. A home that relied on user settings the operator
  later changed no longer runs unguarded, and a home set up before these baselines catches up. A
  project that sets `sandbox.enabled` either way is left alone, and an entry moved to `ask` or
  `allow` stays out of `deny`.
- Init checks that the plugin's packages are installed before it asks anything, and stops with
  the one `bun install` command for your terminal when they aren't, the normal state after a
  marketplace install. It used to mention the install only at the end, after steps that already
  needed the plugin's server.
- The Perplexity key is optional. Without `PERPLEXITY_API_KEY`, the morning brief (and the sync
  that runs it) searches through the host's built-in web search, with the time window and
  country written into the query and undated results dropped. The key still adds recency,
  domain and country filters and dated results. Init and configure-skills present it as an
  optional part of the Browser pack, and the tool's missing-key error points at the fallback.

### Removed
- The `standup` and `where-am-i` skills, now `/focus standup` and `/focus where-am-i`. Reports
  keep their slugs and categories, so gap detection and the dashboard still find earlier runs.
- The standalone `<HOME>/focus.html` and its sidebar row.

### Fixed
- Focus: a roadmap that names no task ids no longer flags every milestone as missing a task, an
  unreadable source shows once as unavailable instead of counting in the queue, and the queue
  shows when it was pulled instead of a frozen "0m ago".
- The dashboard reads goals without their list markers, so a numbered Weekly Goals block no
  longer shows a number inside a bullet, and the week block's `_Set …_` footer no longer counts
  as a goal.
- The status line's context bar fills at least one cell for any usage above zero.
- A double-quoted task list item with escaped characters (`\t`, `\n`) is decoded like a scalar.
- Tax: coverage prices only an unbroken run of closes, a payslip is missing only after payday, a
  new company's close run and projection start at the month it began, impossible months and
  unreadable amounts are refused, openings are companies only, and only past payments count.

### Upgrade
- `deps: required` — `@modelcontextprotocol/server` replaces `@modelcontextprotocol/sdk`; run bun install in mcp-server.
- `script: required` — run skills/upgrade/scripts/0.6.0.ts (removes the generated home `focus.html`, which the dashboard's Today → Focus view replaces). A `focus.html` without the `focus-data` block is hand-made and is left in place; the report names it. Project focus pages are untouched. It also drops the dead `Skill(agent-kevin:standup)` and `Skill(agent-kevin:where-am-i)` grants from `.claude/settings.json` `permissions.allow` (the settings merge only adds, so the removal lives here); every other entry keeps its place.
- `settings: mandatory` — upgrade's baseline reconcile sets `env.ANTHROPIC_DEFAULT_HAIKU_MODEL` to `claude-sonnet-5-5` in `.claude/settings.json` when the home has none or still has `claude-sonnet-4-6`; any other model the operator chose is kept. Applied automatically.
- `settings: mandatory` — upgrade's baseline reconcile adds the Python guard (`Bash(pip install*)` and its variants) to `permissions.deny`, and `~/.cache/uv` plus `pypi.org` and `files.pythonhosted.org` to the project `sandbox`, when the home lacks them; an entry the operator already placed in allow or ask is kept as theirs. Applied automatically.
- `settings: mandatory` — the same reconcile writes init's core deny list into `permissions.deny` when the user settings have no deny list, and init's sandbox block into the project `sandbox` when neither the user settings enable the sandbox nor the project sets `sandbox.enabled` (skipped on native Windows). Existing values win and lists union. Applied automatically.
- `template/AGENTS.md: mandatory` — the memory-routing row and the `reports/radar/` tree comment name the focus skill's standup and where-am-i playbooks instead of the retired skills, and Toolchain gains the Python line (`uv run --with`, never pip).
- `manual: none` — `/agent-kevin:standup` is now `/agent-kevin:focus standup`, and `/agent-kevin:where-am-i` is `/agent-kevin:focus where-am-i`. Plain asks ("standup is coming up", "where am I") route there on their own.

## [0.5.3] - 2026-09-29

### Added
- **`tax` skill.** Bookkeeping and tax compliance for the operator's companies and personal
  return, laid out like `engineer`: a router over eight playbooks (setup, calendar, capture,
  close, estimate, accountant, optimize, year-end), a help card, and a Malaysia reference with
  every obligation, penalty and lever tied to its statute. Entity profiles list obligations as a
  period plus a due rule; the calendar turns each one inside its lead window into a dated task.
  A tax dashboard prices what is owed right now, shows each company's books month by month with
  what is left to collect, and shows a withheld individual's filing balance and unused reliefs.
  It never files, pays, or sends anything, and never transcribes a residential address.
- **`focus` skill and `focus_write` tool.** `/focus` renders `<HOME>/focus.html` across every
  project, `/focus <project>` renders `projects/<slug>/focus.html`: up to three things today,
  work carried over, due work nobody planned, the roadmap's slipped and in-flight milestones,
  this week's and this month's goals with progress, and the PRs and reviews waiting on the
  operator. `/focus add` turns a line, a list, or a GitHub or Slack link into a planned task;
  `/focus plan` picks today's three. Slack is used when a Slack server is connected, skipped
  silently otherwise. Each page embeds what it shows as JSON in a `focus-data` block, the same
  data `focus_write` returns, and every dashboard rebuild re-renders the pages that exist. The
  home page appears in the dashboard as Focus, and each project page links from its project card.
- **Task horizons.** A task can carry the day, week, or month it is planned for (`2026-09-28`,
  `2026-W40`, `2026-10`, or `later`); the tools and CLI accept `today`, `week`, `next-week`,
  `month` and `later`. Once the period ends the task reads as carried over, with no rollover job.
  `task_query` filters by lane.
- `task_scan` gains a `dueSoon` bucket (open work due in the next 14 days), surfaced by sync,
  quick-pulse and both briefings. Sync nudges a monthly tax close that is missing.
- `github_pr_list` takes `author`, `reviewRequested` and `search` filters and returns
  `mergeable`, so one call answers "what is mine" and another "what am I holding up".
- A roadmap check script (`skills/roadmap/scripts/check.ts`) that every roadmap write ends with.

### Changed
- **Roadmap data is inline JSON.** A roadmap page carries its data in a
  `<script type="application/json" id="roadmap-data">` block with dated periods, so the focus
  page can read milestones without running the page. The template and the roadmap skill write
  this form, and existing roadmaps migrate on upgrade (see below).
- The morning brief's Today section is the focus page's Today lane. Standup takes Next from it
  and gains a week frame: Monday proposes and plans the week's goals, and Friday scores them.
  Where-am-i triage points an overwhelmed operator at `/focus plan`.
- Written frontmatter stays flat and valid YAML: `report_write` rejects nested values,
  `adversarial-review` records repos, heads and paths as flat lists, the task writer escapes
  quotes in titles, and `knowledge_lint` flags a nested frontmatter value.
- The manual and the Xcode rule say a `sandbox.excludedCommands` entry matches only the bare
  command, so a leading `cd … &&` or a trailing redirect sends it back into the sandbox.

### Fixed
- `bun test` from the repo root no longer writes fixture homes into the checkout; a root
  `bunfig.toml` preloads the throwaway test home.

### Upgrade
- `script: required` — run skills/upgrade/scripts/0.5.3.ts (moves each `roadmap.html` in the home and under `projects/<slug>/` to an inline `roadmap-data` JSON block). A page is replaced only when both versions render the same DOM with not one pixel different; any other page is left untouched and keeps working, and the report names it. Before/after screenshots stay under `.kevin/updates/roadmap-json-<stamp>/`.
- `settings: mandatory` — upgrade's baseline reconcile adds `mcp__plugin_agent-kevin_kevin__focus_write`, `Skill(agent-kevin:focus)` and `Skill(agent-kevin:tax)` to `permissions.allow`. Applied automatically; every addition is named in the report.
- `template/AGENTS.md: mandatory` — Conventions gains "Frontmatter values are flat"; Platform's sandbox paragraph gains one sentence on comparing a blocked command with the last run that worked.
- `manual: optional` — Xcode pack homes only: `.claude/rules/xcode.md` gains the bullet "An excluded command must be the whole command line" after the two shell exceptions. Add it by hand; homes without the pack skip this.
- `manual: optional` — tax deadlines: run `/agent-kevin:tax setup` to create an entity profile per company and for yourself; nothing is created until you do.

## [0.5.2] - 2026-09-28

### Changed
- **PR work moves into the `engineer` skill.** `pr-review` and `pr-walkthrough` are retired as
  skills and become three engineer playbooks on one shared PR foundation (resolve the PR, prior
  context, understand the change, a local build in a worktree): `/engineer review <n>` for a
  teammate's PR, `/engineer replies <n>` for the review on your own (fixes left uncommitted,
  replies drafted), and `/engineer walkthrough <n>` to present or record your own. The review
  lanes now apply the engineer principles, and still never post to GitHub. `adversarial-review`
  stays its own skill, since it reviews plans and documents as well as code.
- Review lanes gain three checks: a fallback that can re-send an instruction the first path may
  already have carried out, pre-existing internal-name leaks in code the PR touches, and no
  internal partner or vendor name inside a suggested user-visible string. Understanding the
  change now reads any chat thread the PR body cites.
- The init and templates wording, the dashboard cheatsheet, the reports category dot, the GitHub
  pack walk, and the README docs map (Second-model review under Modules) point at the engineer
  PR playbooks.
- SOUL's Writing Style drops the em-dash rule.

### Fixed
- The SessionStart banner shows the status-line warning only when no upgrade is due, instead of
  both lines for one fix, and upgrade's "Already up to date" exit now re-points the status line
  too (before, the banner sent a current home to upgrade, which stopped before that step).
- The secrets round-trip tests skip when a command sandbox refuses reads on a secrets store,
  instead of reporting six failures unrelated to the change under test.

### Upgrade
- `settings: mandatory` — in `permissions.allow`, remove `Skill(agent-kevin:pr-review)` and `Skill(agent-kevin:pr-walkthrough)` if present; `Skill(agent-kevin:engineer)` covers PR work now.
- `template/AGENTS.md: mandatory` — the memory-routing row, the `reports/reviews/` tree comment, and "Where Your Code Lives" name the engineer PR playbooks instead of the retired skills.
- `template/IDENTITY.md: optional` — the Operational Pattern "Code" line names the engineer skill for all code work, including PR reviews, replies, and walkthroughs.
- `template/SOUL.md: optional` — Writing Style drops the em-dash rule.
- `manual: none` — `/agent-kevin:pr-review <n>` is now `/agent-kevin:engineer review <n>` (or `replies <n>` on your own PR), and `/agent-kevin:pr-walkthrough <n>` is `/agent-kevin:engineer walkthrough <n>`. Plain asks ("review 142", "walk me through my PR") route there on their own.

## [0.5.1] - 2026-09-26

### Added
- **Home history.** The `home_history` tool and the `history` skill give a home local version
  history without the operator knowing git. A cloud-synced home (iCloud, Dropbox, OneDrive,
  Google Drive) keeps it in a local folder behind a one-line `.git` link, since sync services
  damage git internals. Setup stamps the history with its home and manages only what it stamped;
  a history set up by hand is left alone. Init offers it, the session banner and the dashboard
  show it, SessionStart puts back a `.git` link a synced folder deleted, and sync never makes the
  first snapshot or commits into another home's history. Written for macOS, Windows and WSL; not
  yet run on a real Windows machine.
- **`/engineer simplify`** gets its own playbook, carrying the retired `simple-simplify` audit
  whole, and **`/engineer help`** replies with a menu card of every playbook.

### Changed
- **Upgrade backfills init's baseline every run:** missing `.gitignore` rules, the
  `permissions.allow` / `permissions.ask` entries and `plansDirectory`, via
  `skills/init/scripts/home-baseline.ts`. An entry the operator put in `ask` or `deny` is never
  granted.
- **Worktree teardown.** `pr-review` removes the review worktree it created once the report is
  saved (review mode only; never the operator's own branch), and the setup-worktree audit holds
  back a worktree a session from the last day is working in. The `worktree-cleanup` playbook is
  retired into setup-worktree.

### Fixed
- `writeFileAtomic` writes to a unique temp file, so two writers of one file no longer share a
  temp path, and writes through a symlinked file instead of replacing the link; the home
  `.gitignore` template ignores `.claude/settings.local.json*` so a crash-leftover temp copy stays
  out.
- Stuck home-history states from the pre-release review: a deleted history folder, a leftover
  `index.lock` from a crashed first snapshot, a home moved to a new path, a folder that starts
  syncing after setup, git older than 2.28, a renamed runtime folder, and a home that lost both
  its link and its settings record (it reattaches instead of starting a second history).
- The `history` skill runs setup on any home whose history is on, instead of stopping at status.
  A history folder moved and stamped by hand read as `on` but never got its location or write
  grants recorded, so sync could not commit into it. Setup now also regenerates the Codex wiring when it records the folder, so Codex can write the history too.
- Tower and other tools that open the history folder directly show the home's files instead of
  every file deleted: setup records the home as the history's working copy, and session start
  repairs it after a rename or on an older setup.

### Upgrade
- `settings: mandatory` — upgrade's built-in baseline reconcile backfills `plansDirectory` and any missing init `permissions.allow` / `permissions.ask` entries, including the new `mcp__plugin_agent-kevin_kevin__home_history` and `Skill(agent-kevin:history)`. Applied automatically; every addition is named in the report.
- `template/.gitignore: mandatory` — ignore `.claude/settings.local.json*`, so a temp or backup copy of the local settings stays out of history; any other missing rule (incl. `!.kevin/knowledge.json`) is backfilled too. The baseline reconcile applies it.
- `manual: optional` — turn on version history for this home any time with `/agent-kevin:history`. Nothing is applied automatically; a history set up by hand is left as it is.

## [0.5.0] - 2026-09-23

### Changed
- **Upgrade merges templates three ways.** A changed section is rebuilt as the new template plus
  every line the operator wrote in it, instead of being replaced wholesale. `template-drift.ts`
  takes `--base` (the templates at the home's baseline) and marks each home-only line as the old
  template's wording or the operator's; it now covers the Claude bridge too. Upgrade reads that
  base from `.kevin/template-base`, else the plugin's baseline tag, and asks when an operator's
  edit collides with a line the release rewrote or no base exists. Init and every upgrade
  snapshot the templates they applied into `.kevin/template-base`.
- The manual's "Verify before claim" asks for each finding in a multi-finding analysis to be
  rechecked and labelled confirmed, strong, or guess, with a guess never in the headline. Three
  Code style / Code quality lines the `engineer` skill already covers are dropped.
- SOUL's Writing Style splits the group-explanation clause into its own bullet (explanation, not
  a findings list), and adds "I still don't understand" twice means a new angle, and shared
  artifacts name roles, never the agent or the model.

### Fixed
- **Native Windows.** `template-drift.ts` reports the preferences facet as `knowledge/user/preferences.md` on every platform, and reads CRLF files line by line. The demo seeder, which needs a POSIX shell, now stops with a clear message on Windows instead of failing mid-render, and its test is skipped there.

### Upgrade
- `template/AGENTS.md: mandatory` — Workflow's "Verify before claim" line extended; three Code style / Code quality lines removed (section-aware three-way merge; operator lines and home-only sections untouched).
- `template/SOUL.md: optional` — Writing Style: one bullet split in two, two new bullets; an operator's edited copy is diffed first.

## [0.4.12] - 2026-09-23

### Added
- **`engineer` skill.** A working method for code work in a repo: fix a bug, build a feature,
  refactor or simplify, chase a slowdown, prototype, explain how or why code is shaped the way
  it is, check a change's blast radius, architect, interrogate a branch, or drive a long run.
  It picks a playbook, applies 23 engineering principles (read on demand, one file each), and
  runs a comment pass before any diff is shown. Adapted from pstack (MIT, credited in `NOTICE`
  and in each file) and rewritten against the house rules.
- **`self-review` measures a home against the templates every cycle.** `template-drift.ts`
  prints the sections and lines a home's SOUL, IDENTITY, AGENTS, and rule files carry that the
  templates lack, and flags rule-shaped bullets in USER.md and the preferences facet. Each line
  is sorted into generic (promote upstream), personal (remembered), or pending upgrade.
- `demo-home.ts` seeds a fictional home and renders the public demo dashboard from it, with
  every machine path rewritten and a refusal to write if one survives.
- `skills.test.ts` parses every SKILL.md frontmatter, checks the name matches its folder, holds
  each description to the 1,024-character cap, and resolves relative links inside skill folders.

### Changed
- **Generic rules from real homes moved into the templates.** The manual gains Workflow lines
  (git, release, repo-state, verification, and diff hygiene), Platform paragraphs ("keep the live
  home out of harm's way", shell commands you run or hand over), "Reading the operator", and
  Toolchain, Comments, and Code quality lines. Engineering Standards is condensed and indexes the
  `engineer` principles. SOUL gains writing-style bullets, "Recommend once, then build", and two
  confidentiality Boundaries. IDENTITY's Operational Pattern is seeded. The Claude Code bridge
  keeps settings changes in the home.
- The TypeScript rule is rewritten around types, narrowing, and boundary parsing plus house
  idioms. The Swift rule gains a Types section.
- `preferences.md` holds personal tastes only. Working rules route through feedback into
  Learnings, and init seeds a skeleton instead of defaults that repeated the manual.
- Review, spec, and writing skills carry the engineering principles.
- Links to the retired `dev.agentlayer.one` point at `agentlayer.one`.

### Fixed
- Four skills shipped frontmatter a YAML parser rejects, and `where-am-i`'s description ran past
  the 1,024-character cap hosts truncate at.
- Shipped files no longer carry a real operator's name, projects, or personal defaults; examples
  use a fictitious operator.

### Removed
- `simple-simplify`. Its audit criteria live in `engineer`'s refactoring playbook, which also
  answers review-only "simplify this" requests.
- The unused `templates/USER.md`; init writes USER.md from its own inline template.

### Upgrade
- `settings: mandatory` — in `permissions.allow`, add `Skill(agent-kevin:engineer)` and remove `Skill(agent-kevin:simple-simplify)` if present.
- `template/AGENTS.md: mandatory` — new Workflow, Platform, "Reading the operator", Toolchain, Code style, Comments, and Code quality lines; Engineering Standards condensed around a Principles index (section-aware merge; home-only sections untouched).
- `template/CLAUDE.md: mandatory` — Claude Code Session Rules gains one line: settings changes go in the home's `.claude/`, never the user-level `~/.claude/settings.json`.
- `template/SOUL.md: optional` — new Writing Style bullets, the "Recommend once, then build" Core Truth, and two Boundaries; an operator's edited copy is diffed first.
- `template/IDENTITY.md: optional` — Core Role widened, Operational Pattern seeded, and one Safety & Privacy line (never print a secret into chat); offered as a diff because the operator owns the section.
- `template/rules/typescript.md: optional` — rewritten (types, narrowing, calls and runtime, house idioms); an operator's edited copy is diffed first.
- `template/rules/swift.md: optional` — new Types section; an operator's edited copy is diffed first.
- `manual: optional` — Xcode pack homes only: `.claude/rules/xcode.md` gains one line under "One build driver at a time" ("Leave the headless service itself running; stop it only when the operator says they are opening Xcode."). Add it by hand; homes without the pack skip this.
- `manual: none` — `/simple-simplify` no longer exists; use `engineer` (or ask to "simplify this").

## [0.4.11] - 2026-09-23

### Changed
- **`pr-adversarial` is now `adversarial-review`, and it reviews any of the operator's own
  work.** It handles four kinds of target: a PR, a commit range, an uncommitted working tree,
  or a set of paths (a plan, spec, skill, or document). The claims to falsify come from
  whatever states the intent: commit messages, the task and plan, or the document's own
  assertions. The verify rubric is mapped onto prose, and fixes are committed only when the
  target is committed code. Dossiers are found by the `adversarial` tag instead of the
  `skill:` field, so existing `adversarial-*` dossiers still resolve. The slash command is
  `/agent-kevin:adversarial-review`.
- **Init defaults to Opus at high effort.** The model question recommends Opus over Fable,
  and `effortLevel: "high"` is always written to project settings next to the model instead
  of only filling a gap left by the global settings. The home runs the same model and effort
  on every machine.
- The Claude status line shows the effort level, dimmed, beside the model name. It shows
  nothing when the host omits it.

### Upgrade
- `settings: mandatory` — replace the renamed skill grant in `permissions.allow`: remove `Skill(agent-kevin:pr-adversarial)`, add `Skill(agent-kevin:adversarial-review)`.
- `template/AGENTS.md: mandatory` — the reporting-skills row, the `reports/reviews/` tree comment, and the "Where Your Code Lives" sentence now name `adversarial-review`.
- `settings: optional` — set `"model": "opus"` and `"effortLevel": "high"` in `.claude/settings.json`. Ask with the current values shown next to the new ones. A yes sets both, even over an existing project value, because the operator is choosing on this run. Skip if the operator prefers Fable or their global default.
- `manual: none` — `/pr-adversarial` no longer exists; use `/agent-kevin:adversarial-review`. Existing `adversarial-*` dossiers keep working, and the `skill:` field in their frontmatter is historical.

## [0.4.10] - 2026-09-23

### Added
- **`self-review` prunes first.** Before proposing anything new it runs a deletion pass
  (graduated learnings, superseded or dead references, rules a guard already enforces, model
  defaults retired on trial, stale memory) and reports the always-loaded bytes per host before
  and after. Two new scripts back it: `context-weight.ts` measures Claude's bridge, imports and
  unscoped rules separately from Codex's manual and static stack, and `plugin-source.ts`
  resolves the install mode (contributor / consumer / ambiguous) from the hosts' enabled
  registrations, so a plugin-level fix is edited in a local checkout for contributors and lands
  as a home override plus an upstream proposal for marketplace installs.
- **`graduated:` markers.** A theme carrying one drops out of the compiled Learnings; a
  `graduated-rule:` marker moves a single rule out of a theme and keeps the rest.
- `sync` nudges `self-review` 30 days after the previous run, even without new feedback.

### Changed
- **Codex homes mirror pack MCP servers from `.mcp.json`.** `codex_setup` now owns a
  `[mcp_servers.<name>]` table for every server a pack registered (the Xcode pack's `xcode`),
  regenerated each run with the operator's own keys kept and dropped once the pack is
  deconfigured. A home that activated a pack before wiring Codex now gets the server; the pack
  walk calls `codex_setup` instead of hand-merging TOML. Upgrade's Codex regeneration applies
  it with no extra step.
- `TASKS.md`'s Stale section is an id index per project (id and last-update date, oldest first)
  instead of repeating every task line: 33 KB to 20 KB on a 68-stale board.
- `knowledge-compile`'s Open Questions carry only stale, contradiction and missing items; a
  filled gap drops off rather than lingering as `[resolved]`.
- `release` documents that a pushed tag never moves.

### Fixed
- `memory_prune` rewrites an archived `[[memory/<date>]]` link whose daily file is gone to
  "the <date> session log", so decision archives stop accumulating dead links.
- A broken `.mcp.json` or settings file names itself in the Codex generator's parse error.

### Upgrade
- `template/AGENTS.md: mandatory` — Operational Rules and most of Session Rules removed (they repeated SOUL, Memory Routing and Workflow), "Ship > Start" moves into Workflow, the Architecture references list is retired, and Platform gains "a command the sandbox blocks is the operator's to run".

## [0.4.9] - 2026-09-18

### Added
- **Xcode pack.** An integration pack, not a skill pack: it makes Apple's toolchain reachable
  from an agent session and ships no skills of its own. `configure-skills` §A.2f preflights the
  host (macOS, full Xcode 27 or later, the headless `mcp-server` binary), registers Apple's
  Xcode MCP server as `xcode` in `<HOME>/.mcp.json` (`xcrun mcpbridge`), grants
  `mcp__xcode__*` with `RunCodeSnippet` and `InvokeDebuggerCommand` held in `ask` (the two
  tools that execute model-composed code outside the seatbelt), allows `xcodebuild` and
  `xcrun simctl` in Bash with simulator destruction and the whole upload path
  (`-exportArchive`, `altool`, `notarytool`) gated, seeds two coding rules
  (`.claude/rules/xcode.md`, always on, and the path-scoped `xcode-project.md`), offers an
  `AGENTS.md` scaffold for an app repo or a Swift package plus the `.claude/CLAUDE.md` bridge
  and an `.xcode-version` pin, and adds `[mcp_servers.xcode]` to Codex homes. Two steps stay
  the operator's, generated paste-ready into `.kevin/updates/xcode-sandbox.md`: the
  `sandbox.excludedCommands` entry (an agent widening its own sandbox is refused, correctly)
  and the sudo-gated headless enablement. Offered by init and configure-skills on macOS only;
  deconfigure keeps every `ask` rule in place. Deep Apple guidance (concurrency, Swift Testing,
  SwiftUI, WidgetKit, App Intents) stays in separately-authored MIT skills installed per repo.
- `templates/repo/AGENTS-apple-app.md` and `AGENTS-apple-package.md`: fill-in agent manuals for
  an Apple repo (targets, schemes, versioning, dependency policy, the build loop through the
  `xcode` server, the verification ladder, pitfalls). Never copied into a HOME.

### Changed
- **`pr-review`, `pr-walkthrough`, and `pr-adversarial` fire on how the operator asks**
  ("review 610", "walk me through my PR", "get a second model on this branch"), not only on
  their slash names. The three carried `disable-model-invocation`, so a `Skill(...)` call
  hard-refused despite descriptions that advertise trigger phrases. GitHub-pack skills earn
  this exception because failing unconfigured is free and self-correcting: one `github_pr_*`
  call returns `GITHUB_TOKEN not set` and stops. The SEO six and `browser-flows` keep the flag.
  Init's allow list gains the three skill grants (fifteen to eighteen).
- **Paste blocks read like the operator wrote them.** The `pr-review` replies report is flat:
  frontmatter, one intro sentence, then threads, each headed by a permalink to the exact
  comment. Reply voice is first person with the answer in the first three words; length follows
  the question (the 40-word cap is gone). No `Blocking:` / `Nit:` / `Question:` prefixes in any
  paste block; severity stays in the report. The reviewer's words sit on a plain `<name> wrote:`
  line so the only blockquote on screen is the thing being pasted.
- **Diagrams in a report are Mermaid, never ASCII.** Report files are read in Obsidian and on
  GitHub, which render it; the ASCII rule is scoped to terminal and chat. `pr-review`,
  `pr-walkthrough`, `plan-spec`, and `standup` had it backwards, and `pr-review`'s Tier 1 parse
  check is now unconditional.
- `templates/rules/swift.md` gains Concurrency (no `@unchecked Sendable` to silence a
  diagnostic, main-actor closure inheritance, non-main system delegates), Swift Testing (struct
  suites, `try #require` before comparing an optional, `withKnownIssue` for tracked bugs),
  time-as-an-input, the toolchain rule, and a further-reading list of separately-authored
  skills in place of the single Dimillian link.
- Init seeds `.claude/rules/` by name (`typescript`, `swift`) rather than by glob, so the
  pack-gated Xcode rules never land in a home that did not activate the pack.
- `CONTRIBUTING.md`'s new-skill frontmatter template no longer ships
  `disable-model-invocation: true` by default; it names what earns the flag, pack-gating
  included. `release` documents that a pack-gated rule is never `additive`.

### Upgrade
- `settings: mandatory` — add to `permissions.allow`: `Skill(agent-kevin:pr-review)`, `Skill(agent-kevin:pr-walkthrough)`, `Skill(agent-kevin:pr-adversarial)` (the three are model-invocable now; without the grants each auto-fire raises a confirm prompt).
- `template/rules/swift.md: optional` — five new sections (Concurrency, Testing, Time is an input, Toolchain, Further reading) replace the old References block; an operator's edited copy is diffed first.
- `manual: optional` — the Xcode pack is opt-in and macOS-only: on a Mac with Xcode 27 or later, run `/agent-kevin:configure-skills` → Xcode. That walk seeds `.claude/rules/xcode.md` and `xcode-project.md` and prints the two operator steps (sandbox exclusion, sudo enablement); upgrade never copies those rules. Every other home has nothing to do.

## [0.4.8] - 2026-09-17

### Added
- **`pr-adversarial`: a cross-model review loop on one dossier.** For the operator's own work
  (a branch, a PR, or several repos moving together), split by trust: the reviewing model
  documents, the implementing one codes. `brief` writes a self-contained prompt into
  `reports/reviews/` (stakes, repos and ranges, the bug classes already seen, every commit
  message turned into a numbered claim to falsify, an output contract) and hands back the one
  line a second model needs to append its findings to that same file. `verify` checks each
  finding against the code with `pr-review`'s rubric, fixes and commits the real ones on the
  branch, records the disposition and a ledger so a settled finding is never raised twice,
  re-cuts the brief at the new heads, and hands back the next round's prompt. Slash-only
  (`/agent-kevin:pr-adversarial`), with `--reviewers <n>` for parallel slots, `--no-commit`,
  `--refresh`, `--repo`, and `--doc`. Nothing is posted anywhere; the operator carries the
  file between sessions.

### Changed
- `pr-review` carries an `adversarial-*` dossier as prior context the way it already carries a
  walkthrough: the Ledger says what a second model raised and how each finding was dispositioned.
- The dashboard cheatsheet, the GitHub pack walk, the `report_write` tool description, the
  README, and the operating manual name the third PR skill alongside `pr-review` and
  `pr-walkthrough`.

### Upgrade
- `template/AGENTS.md: mandatory` — three lines name `pr-adversarial`: the reporting-skills row
  in Memory Routing, the `reports/reviews/` line in the tree, and "Where Your Code Lives".

## [0.4.7] - 2026-09-15

### Added
- **Host version floors, no shims.** `mcp-server/src/hosts.ts` names the Claude Code and Codex versions
  the plugin is built against (2.1.269 and 0.154.0); `kevin hosts` checks the installed CLIs, init and
  upgrade stop below a floor with the update command, and the SessionStart banner warns until the host
  is updated. Codex counts only for a home wired for it. A release that leans on a newer host feature
  raises the floor in the same commit.
- **`bashEditDiffEnabled` in the home's settings.** Auto mode routes file edits through the Bash tool, which
  hides the diff the Edit tool would have shown; Claude Code 2.1.269 added a setting that attaches a diff
  of the files a Bash command changed to that command's result. `init` writes it when the user-global
  settings don't set it, and upgrade adds it to existing homes (an operator's own value is kept).
- **Tools can publish MCP `_meta`.** `ToolDef.meta` is passed through `registerTool`; `compile_next`
  declares `anthropic/maxResultSizeChars` so a compile item lands in the conversation instead of being
  parked in a `tool-results` file the caller has to page through.
- **The Codex user-level note recommends trusting the home.** `projects."<home>".trust_level = "trusted"`
  skips the first-launch folder-trust prompt; Codex reads the home's `.codex/` only for a trusted folder.

### Changed
- **Compile prompts no longer embed the manual, `USER.md`, the wiki index, or the memory index.** Every
  one of them is already in the caller's context, and carrying them made each `compile_next` result
  more than double the size of its raw input.
- **The upgrade skill's gitignore step drops its `!` workaround.** The Bash tool no longer mangles a
  leading `!` or the negation operator (verified on Claude Code 2.1.270), so the octal-escape dance is gone.
- **The Codex SessionStart banner travels as `systemMessage` in the JSON envelope.** Codex accepts the
  same hook envelope as Claude Code and renders it as a hook cell, so the Codex path returns the shared
  result shape and the CLI emits JSON for both protocols; the context payload is unchanged. Pre-init and
  stranded homes get the uncolored wordmark because Codex's TUI prints ANSI escapes as raw bytes. Codex
  fires SessionStart on the first turn, so the banner lands under the first prompt rather than at launch.

### Removed
- **The additional-directories env setting.** 0.4.6 had `init` and upgrade write
  `env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1"` into the home's settings so repos listed in
  `permissions.additionalDirectories` would load their `CLAUDE.md`. A probe matrix on Claude Code
  2.1.270 showed the key inert in every case: the flag is honoured only from the shell environment
  at launch, never from the settings `env` block, and `additionalDirectories` grants file access
  only, loading no instruction files under any flag. `init` no longer writes it, and the 0.4.6
  Upgrade line is withdrawn so a home upgrading past that version gets nothing. Eager loading of a
  repo's manual is the shell form, `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude --add-dir
  <repo>`; the default is on demand, and the operating manual's read-on-demand list names a code
  repo's `AGENTS.md`.

### Upgrade
- `manual: optional` — a home that ran the 0.4.6 upgrade holds `env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` in `<HOME>/.claude/settings.json`; delete the key, and the `env` block if that leaves it empty. It is inert, so leaving it changes nothing.
- `settings: mandatory` — `bashEditDiffEnabled: true` in `<HOME>/.claude/settings.json` (an operator's existing value is kept).
- `template/AGENTS.md: mandatory` — Context Loading's read-on-demand list gains the code repo's `AGENTS.md` (read with the harness bridge beside it whenever a task lands in that repo; one bullet).
- `template/CLAUDE.md: mandatory` — Claude Code Context Loading gains the two-file repo read: `AGENTS.md` then `.claude/CLAUDE.md`, since a manual `Read` does not resolve `@-imports` (one paragraph).

## [0.4.6] - 2026-09-15

### Added
- **Swift review addendum for `pr-review`.** `references/langs/swift.md` extends the
  correctness, invariants, and security lanes for `.swift` files (ported from
  alibaba/open-code-review, Apache-2.0, credited in the file): optionals and runtime
  failures, ARC and memory ownership, error handling, Swift concurrency and isolation, SwiftUI
  state and lifecycle, SwiftData / Core Data persistence, health, purchases, and privacy,
  networking and external input, unsafe interop, and tests. Attached to a lane's prompt
  whenever the changed files include Swift; language addendums extend the lane checklist,
  never replace it.

### Changed
- **`pr-review` tracks coverage, anchors by code, and protects the subjects that must not
  drop.** The diff's file list is now a coverage checklist: every file ends the review as
  `reviewed` or `skipped (<reason>)`, per lane and in the report's Checks run table, and an
  implementation file no longer covers its interface, schema, migration, or config
  counterpart. Findings carry the anchored lines verbatim (`code:`) so the verifier re-finds
  them when line numbers drift instead of failing the finding on a stale citation. Candidates
  that fail verification are listed one line each under "Dropped after verification", never a
  bare count, and a candidate about authorization, data loss, concurrency, or a behavior or
  compatibility change survives as a question for the author unless the verifier names the
  exact code or command that disproves it.
- **`github_pr_comments` returns each inline comment's `diffHunk`**, so the reply mode
  re-finds an outdated thread by the reviewer's quoted snippet rather than the stale line
  number.

### Fixed
- **Additional directories load their instruction files.** Claude Code discovers skills from
  `permissions.additionalDirectories` on its own, but loads a directory's `CLAUDE.md`,
  `.claude/CLAUDE.md`, `.claude/rules/*.md`, and `CLAUDE.local.md` only when
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` is set, so every repo's `CLAUDE.md` (and its
  `@AGENTS.md` bridge) was silently skipped in sessions launched from the home. `init` now writes
  the flag into the home's `env` alongside the code-root grants, and upgrade adds it to existing
  homes. Claude Code only: Codex layers `AGENTS.md` by directory walk natively. *Withdrawn in 0.4.7:
  the setting proved inert.*

### Upgrade
- Withdrawn: the settings action that added `env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` was removed after the key proved inert (see 0.4.7). Nothing to apply for this version.

## [0.4.5] - 2026-09-13

### Added
- **`pr-walkthrough`: understand, present, and record your own PR.** Author-side only, the
  counterpart of `pr-review`. Rebuilds the change hunk by hunk from the diff, the task, and
  the sessions that wrote it, classifies each hunk by how hard it is to defend, verifies
  build/lint/tests locally, then writes one glanceable side-screen doc: a two-minute standup
  script, the diff tour in scroll order, the questions reviewers will ask with receipts, and a
  scene-per-path recording runbook. Undefended hunks become gaps with an action, never a
  bluff. `--rehearse` runs an interview (the room's questions one screen at a time, its
  misconceptions as the wrong options, every miss corrected against the code); `--check
  <video>` verifies a finished recording covered every scene. Rides the GitHub pack; never
  posts. Writes `reports/reviews/`.
- **The Claude Code status line, rendered by the plugin.** `kevin statusline` draws the footer
  from the status-line JSON: model, folder, and branch on line one; the context bar (shown from
  the first render), cost with the hourly rate, session time, and the Pro/Max rate-limit windows
  on line two. Init writes the `statusLine` entry into the home's project settings, upgrade
  re-points it whenever the plugin cache moves, and the plugin ships its own
  `subagentStatusLine` for the agent panel rows.
- **Codex footer and skills budget.** `codex_setup` writes a `[tui]` status line (model with
  reasoning, directory, branch, approval mode, context used) and a `[skills]` budget of 10,000
  tokens (the most Codex allows; its 2% default shaves the plugin's descriptions) into each
  home's `.codex/config.toml`, keeping an operator's own values.

### Changed
- The user-level Codex note now recommends the model context window, read from Codex's model
  catalog cache (`~/.codex/models_cache.json`) so the paste-ready pair matches the cap the
  operator's account actually has.
- The operating manual template documents the `reports/` tree: a Memory Routing row for the
  reporting skills and the directory layout under Knowledge Structure.
- The dashboard cheatsheet gets a "Presenting or recording your own PR" row, `report_write`
  lists the new skill, the GitHub pack walk and "Where Your Code Lives" name it, `pr-review`
  treats a walkthrough report as the author's stated intent rather than a superseded review,
  and `standup` adds a prep line for each open PR of yours with no walkthrough yet.
- The README's skill count reads 40.

### Upgrade
- `template/AGENTS.md: mandatory` — Memory Routing gains the reporting-skills row and Knowledge Structure gains the `reports/` tree; "Where Your Code Lives" names `pr-walkthrough`.
- `template/USER.md: optional` — the `GitHub login:` line names both PR skills (one clause).
- `manual: optional` — the status line: upgrade writes `statusLine` into `<HOME>/.claude/settings.json` when absent and re-points it when it names a stale plugin path (an operator's own line is kept); nothing to do unless the report shows a permission-error fallback, then paste the printed entry. Shows on relaunch.
- `manual: optional` — Codex homes: upgrade regenerates `.codex/config.toml` with the `[tui]` status line and `[skills]` budget (trust the hooks again via `/hooks`); the larger model context window is a user-level, machine-wide cost choice, so paste the pair from `.kevin/updates/codex-user-config.md` only if you want it.

## [0.4.4] - 2026-09-12

### Added
- **`pr-review`: adversarial pull-request review with no GitHub write access.** Two modes,
  picked by who wrote the PR. Review mode (a teammate's PR) builds the "How it works"
  section first (diagram + walkthrough), fans out across seven lanes (correctness, domain
  invariants and authorization, security, regressions and blast radius, conventions, tests,
  PR hygiene), sends every candidate through an independent verifier that scores it, builds
  and tests the head in a throwaway operator-namespaced worktree, and hands back a report of
  paste-ready inline comments with committable `suggestion` blocks. Reply mode (your own PR)
  judges every review thread against the head code, applies the accurate fixes uncommitted,
  pushes back on the wrong ones with receipts, and drafts replies in PR scroll order. Flags:
  `review` / `reply`, `--quick`, `--no-local`, `--repo`. Rides the GitHub pack; never posts.
- **`reviews` report category.** `report_write` accepts it, the dashboard orders and colors
  it, and the report scan picks it up, so review reports surface in SessionStart context.

### Changed
- The dashboard cheatsheet gets a "Reviewing a PR" row, the GitHub pack walk in
  `configure-skills` names the skill that rides it, and init's `AGENT_REPORTS` note lists
  `reviews` among the categories.

### Upgrade
- `template/AGENTS.md: mandatory` — "Where Your Code Lives" names the `pr-review` skill among the tasks that target the code path (one clause).
- `template/USER.md: optional` — a `GitHub login:` line under "Where Things Live". The skill reads it to tell your PRs from teammates' and offers to fill it in on first use, so skipping this only means one extra question later.

## [0.4.3] - 2026-09-10

### Changed
- **The README is a landing page; the manual lives at [dev.agentlayer.one/docs](https://agentlayer.one/docs).** Pitch, the loop, a quick start for both hosts, a section map into the docs site, and highlights, with the stale tool and skill counts corrected (56 tools, 38 skills). The docs site is host-neutral, serves `llms.txt` / `llms-full.txt`, and renders this changelog.

### Fixed
- **Seed import refreshes the Codex rules.** The Codex rules file is generated from the `permissions.ask` entries a seed import merges into, so the seed-import skill now calls `codex_setup` when a bundle added ask entries to a Codex-wired home (`.codex/hooks.json` present); before, those commands ran unprompted under Codex until the next upgrade. `codex_setup` is also classified as a core grant by `seed_scan`, so the export interview no longer offers it as a custom entry.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.4.2] - 2026-09-09

### Added
- **The Codex wiring carries the home's posture, read from its Claude settings.** The generator
  now writes a `[permissions.kevin]` profile into `.codex/config.toml` (extends `:workspace`,
  denies every read of `.kevin/secrets/` and of any `.env` under a workspace root while the MCP
  server still reads them, keeps `.git` writable so commits stay routine, and lists the code path
  and `permissions.additionalDirectories` as workspace roots, and enables the network inside the
  sandbox, since an approved escalation does not lift a profile, verified on 0.153), `.codex/rules/kevin.rules` (one
  `prefix_rule` that prompts per `Bash(…)` entry in `permissions.ask`, the same gate Claude Code
  applies), a `[shell_environment_policy]` that hands the model's shell the home variables and the
  home's `AGENT_*` settings (never a key, token, or secret), and the policy keys
  `default_permissions`, `approval_policy = "on-request"`, `approvals_reviewer = "user"` when the
  operator has not set them. Verified live in a fixture home: secrets refused by policy, commits
  inside the sandbox, a push stopped by the rule until the operator approves. The reviewer model
  (`auto_review`) stays opt-in: it denied a named push and a local commit on the same fixture.
- **`codex_setup` MCP tool.** Init and upgrade generate the wiring through it, since a Codex
  session's sandbox keeps the workspace's `.codex/` read-only to the model's shell; the server
  runs outside that sandbox. The shell path stays as the fallback.
- **A paste-ready note for the user level** (`skills/init/scripts/codex-user-config.ts`), the
  Codex counterpart of the Claude auto-mode block: the keys Codex accepts only in
  `~/.codex/config.toml` (analytics, feedback, telemetry exporters, terminal animation and
  alternate screen, update checks, the approval policy and reviewer, a reasoning effort mapped from
  the Claude `effortLevel`), plus, while the user config lacks them, a user-level permission
  profile built from the Claude user settings' `Read(…)` denies and a `~/.codex/rules/default.rules`
  built from its ask list. Nothing in the note names an agent: it governs every Codex session that is
  not an agent home. The plugin never writes a user-level file; init and upgrade save the note to
  `.kevin/updates/codex-user-config.md` and quote it.
- **The home's profile fills whatever the user level does not.** Claude's user-level `Read(…)`
  denies that the operator's user-level Codex profile does not already carry land in the home's
  profile, so a home is covered before the operator pastes anything and the user-level file stays
  theirs, the rule Claude homes follow for settings that exist in the user file.
- The generator is agent-neutral: names, the env prefix, and the rules file come from the plugin
  manifest, so a sibling plugin ships it unchanged.

### Changed
- Init asks under Claude Code, every time, whether the home also runs Codex, instead of skipping
  the step when Codex went unmentioned.
- The generator refuses a `.codex/config.toml` that still carries the legacy `sandbox_mode` or
  `sandbox_workspace_write` keys, naming them: Codex does not combine them with a profile.

### Upgrade
- `settings: mandatory` — add to `permissions.allow`: `mcp__plugin_agent-kevin_kevin__codex_setup` (the new always-on core tool init and upgrade call to write a home's Codex wiring from outside the shell sandbox).
- `manual: optional` — Codex homes: run `$upgrade` (or `/agent-kevin:upgrade`) once; the wiring gains the permission profile, the rules file, and the shell env. The hook commands are unchanged, so no re-trust unless the report says `hooks.changed: true`. If the generator refuses because of legacy `sandbox_mode` keys, delete them from the home's `.codex/config.toml` and rerun. The profile replaces the sandbox the home ran under and an escalation prompt no longer lifts it: a directory the agent writes that is neither the home nor the code path goes into the Claude settings' `permissions.additionalDirectories`, then rerun. Then paste the user-level block the report points at (`.kevin/updates/codex-user-config.md`) into `~/.codex/config.toml`; every line in it is optional. Claude Code-only homes have nothing to do.

## [0.4.1] - 2026-09-07

### Added
- **Codex CLI is a second host.** A checkout installs as a Codex plugin
  (`.codex-plugin/plugin.json`, the same `skills/`) through its own developer
  marketplace (`.agents/plugins/marketplace.json`, named `agentdev-kevin`, like the embedded Claude one).
  Codex 0.153 accepts neither bundled hooks nor a bundled MCP server that can learn which
  home it serves, so both live per home, generated by
  `skills/init/scripts/codex-setup.ts`: `.codex/hooks.json` (a `SessionStart` context
  entry, `SessionEnd` and `PreCompact` captures, the same two moments Claude Code
  captures at, and the `PreToolUse` guard below) and a `[mcp_servers.kevin]` table in
  `.codex/config.toml` with `AGENT_HOME` set. The generator merges into existing files,
  replaces only Kevin's own entries, and validates the TOML before writing. `init`
  (Step 7c) and `upgrade` run it; the operator trusts the folder and the four hook entries
  via `/hooks`. The hook commands carry the home as a double-quoted `--home=` argument
  (`bun "<plugin>/bin/kevin" session-start --hook-protocol=codex --home="<home>"`), no env
  prefix, shaped to parse under sh and under the PowerShell Codex uses on Windows alike.
  Supported today: an existing home run from Codex (`$upgrade` from a Codex session writes
  the wiring). A fresh `$init` under Codex, the upgrade cycle across Codex plugin versions,
  and native Windows (where the skills are bash and Codex runs PowerShell) are not exercised yet.
  Known limits under Codex: skills that name `${CLAUDE_PLUGIN_ROOT}` rely on the plugin-root
  line the SessionStart header carries (an instruction, not a variable); the session radar
  (`where-am-i`, `list_sessions`) reads Claude transcripts only; and nothing in Codex denies
  the model reading the runtime secrets store the way the Claude settings do. Parity for those
  is the next release's scope.
- `bin/kevin … --home=PATH` pins the agent home from the command line, setting both
  `AGENT_HOME` and `KEVIN_HOME` so an inherited override cannot outrank it; the generated
  Codex MCP registration sets both the same way. It is how the Codex hooks name their home.
- `session-start --hook-protocol=codex` prints the static stack (identity files, indexes,
  task board) ahead of the same dynamic lane Claude gets, as one payload; the hook is
  registered with `additionalContextLimit: 0`, since Codex otherwise truncates a hook's
  context at about 2,500 tokens. The payload's first line names the harness so skills can
  tell hosts apart.
- `session-capture --hook-protocol=codex` (`--format=codex`) reads Codex's rollout JSONL:
  user and assistant turns only, with the injected `AGENTS.md`, environment block, and
  `$skill` expansions dropped.
- **`upgrade` starts with a registration preflight** (`skills/upgrade/scripts/registration-check.ts`):
  it reads Claude Code's marketplace registry and installed plugins, the home's settings, and
  Codex's `config.toml`, and reports a checkout registered under a name its catalog no longer
  carries, a retired marketplace repo, or a stale Codex registration, each with the exact
  commands that fix it. The skill quotes them, flips the home's `enabledPlugins` and
  `extraKnownMarketplaces` keys itself, and repeats the commands in its report until a later
  run finds nothing to do.
- **A `PreToolUse` guard on shell commands** (`bin/kevin guard`, wired in `hooks/claude.json` for
  `Bash` and as the fourth Codex hook entry). A `cd` in one shell command moves the session's
  cwd for every later one; a home-relative path such as `projects/blog-dev/posts/…` then lands
  in whatever repo the cwd drifted to. The guard blocks a command that would write under
  `knowledge/`, `projects/`, or `reports/` relatively while the cwd is outside the home (and
  the cwd has no such tree of its own), telling the model the absolute path to use. Reads,
  quoted mentions, and heredoc bodies pass. A `cd` inside the same command is followed too,
  so `cd <repo> && cat > projects/x` is caught from the home; a `cd` to a value the shell
  computes leaves the cwd unknown, which allows.
  Verified on both hosts: Codex presents every shell command to hooks as tool name `Bash` with
  `tool_input.command`, and starts each one in the workspace, so the drift there is only the
  single-command form (its sandbox also denies writes outside the workspace).
- Session block headers record the harness and model that produced the block
  (`· claude: claude-fable-5-1`, `· codex: gpt-6-astra`), scoped to the block's new turns.

### Changed
- Session block headers and `raw/sessions/index.json` are keyed by the **full session
  id**, not its first 8 characters: Codex's time-ordered UUIDv7 ids share a prefix within
  the same ~65 seconds, so a second session could resolve to the first one's cursor.
  Entries written under a short key fold onto the full id on that session's next capture,
  keeping `first_seen`, briefing, and block history.
- The Claude manifest declares its hooks (`hooks/claude.json`, was `hooks/hooks.json`)
  and MCP server explicitly; the plugin-root `.mcp.json` is gone, since Codex
  auto-discovers both default locations. A Claude Code home keeps its three hooks and gains
  the `PreToolUse` guard above; nothing else about it moves.
- The MCP server hydrates the home's `.claude/settings*.json` env on first import
  (Codex does not inject it); the CLI shares the loader. Anything already in the
  environment always wins.
- `release` bumps both manifests; `manifests.test.ts` fails when they drift.
- The Claude developer catalog (`.claude-plugin/marketplace.json`, `agentdev-kevin`) is
  committed, as the Codex one already was, so a plain clone registers on both hosts.
- **The public marketplace is `AgentLayer1/agentlayer-agent-marketplace`**, serving Claude Code
  (`.claude-plugin/marketplace.json`) and Codex (`.agents/plugins/marketplace.json`) from one
  repo. Its name is still `agentlayer` and the plugin id is still `agent-kevin@agentlayer`; the
  old `agentlayer-claude-marketplace` repo keeps working until it is retired.
- Every `disable-model-invocation` skill opens with a one-line operator-only guard: Codex
  lists every plugin skill to the model and ignores that field, so without it the model
  could run `init`, `release`, or `rename-agent` on its own there. Inert under Claude Code,
  where the frontmatter already gates them.
- The sync's brain commit sweeps `.codex/` with the rest of the home's state, so the
  Codex wiring is committed instead of reported as left uncommitted on every run.
- README, `templates/AGENTS.md`, and the init skill name the plugin manifest as where the
  bundled `kevin` server and the Claude hooks are registered.

### Fixed
- A turn truncated (or pasted) inside a three-backtick code fence left the fence open in the
  day file, rendering every later block as code; the capture formatter now closes it before
  the truncation marker (longer and tilde fences are not counted).
- A capture that cannot take the capture lock in time no longer proceeds unlocked or dies to
  Codex's 3-second SessionEnd limit: it is queued in the runtime dir and the next capture, or
  the next session start, drains it. A legacy 8-character index key is now persisted onto the
  full id even when the capture finds no new turns.
- The Codex session start delivers the identity files even when the dynamic lane fails
  to assemble (a marker line takes the lane's place), matching Claude Code's containment.

### Upgrade
- `manual: optional` — the marketplace moved to `AgentLayer1/agentlayer-agent-marketplace` (Claude Code and Codex from one repo). Registered from the old `agentlayer-claude-marketplace`? Run `/plugin marketplace add AgentLayer1/agentlayer-agent-marketplace` then `/plugin install agent-kevin@agentlayer` once: both repos carry the name `agentlayer`, so the new one replaces the old, the plugin id is unchanged, and nothing in your home changes.
- `manual: mandatory` — a local clone registered under any name other than `agentdev-kevin` (a pre-0.4.1 directory install was registered as `agentlayer`) loads no plugin next session, because the clone's catalog is now named `agentdev-kevin`. Re-register it: `/plugin marketplace remove <old name>` (this uninstalls the plugin it brought), `/plugin marketplace add <clone path>`, `/plugin install agent-kevin@agentdev-kevin`. The upgrade's preflight prints these three lines with your paths and renames the home's `enabledPlugins` and `extraKnownMarketplaces` keys itself. Clones already registered as `agentdev-kevin` have nothing to do. Under Codex the plugin is a cache copy either way: `codex plugin marketplace upgrade agentlayer` then `codex plugin add agent-kevin@agentlayer` for the marketplace, or `codex plugin remove` and `add` of `agent-kevin@agentdev-kevin` for a clone.
- `template/AGENTS.md: optional` — the tree-diagram comment on `.mcp.json` now says the bundled `kevin` server is registered in the plugin manifest (one comment line; declining loses nothing).
- `manual: optional` — Codex: this upgrade asks once whether the home also runs Codex and, on yes, writes `.codex/hooks.json` and the `[mcp_servers.kevin]` table in `.codex/config.toml`. Then install the plugin in Codex if you have not (`codex plugin marketplace add <checkout or marketplace>`, `codex plugin add agent-kevin@<marketplace>`), launch `codex` from the home, trust the folder when asked, and trust the four Kevin entries via `/hooks`. A Codex-only home gets the same wiring from `$upgrade` run inside Codex. Claude Code-only homes answer no and have nothing to do.

## [0.4.0] - 2026-09-06

### Added
- **`AGENTS.md` is the operating manual.** The agent home's manual is now a
  harness-neutral `AGENTS.md` at the root, read natively by Codex and every other
  AGENTS.md-aware CLI. Claude Code, which does not read `AGENTS.md`, reaches it through
  a new `.claude/CLAUDE.md` bridge: `@-imports` for the manual, the identity stack
  (SOUL, IDENTITY, USER) and the indexes, plus the few rules that apply only under
  Claude Code (plan mode, the auto-memory override, hook-driven capture). One manual at
  the root, no per-harness copies. `templates/AGENTS.md` is the manual;
  `templates/CLAUDE.md` is now the bridge.
- **`0.4.0` migration** (`skills/upgrade/scripts/0.4.0.ts`): builds `AGENTS.md` from
  the legacy root `CLAUDE.md` (or `CLAUDE.local.md`): template preamble, sections
  carried verbatim, operator preamble kept, operator-added `@-imports` re-rooted into
  the bridge. Writes the bridge, retargets markdown links to the moved file, then
  removes the legacy file. Backs up every touched file to
  `.kevin/updates/0.4.0-manual-<stamp>/`, rolls back every write of the run on any
  verification failure, keeps CRLF line endings, idempotent.
- `ping` reports the plugin `version` the server process loaded, so
  `/agent-kevin:upgrade` can detect a server older than the code on disk and stop
  before a migration silently reads as already applied.
- **The recommended auto-mode block is generated, not transcribed.**
  `skills/init/scripts/automode-block.ts` renders it from the init skill's source of truth
  with the home's path substituted, checks the operator's user-global copy rule by rule
  (exact text, matched by rule name; `environment` is never compared), and writes a
  readable note with the changed sentences and paste-ready replacement entries to
  `.kevin/updates/automode-block.md`. `init`
  prints it at the end of onboarding; `upgrade` re-checks it every run. Print-only, as
  before: the plugin never writes `~/.claude/settings.json`.
- **Session start flags a broken manual layout.** When `AGENTS.md` exists but the
  `.claude/CLAUDE.md` bridge is missing, or a pre-0.4.0 root `CLAUDE.md` still sits beside
  `AGENTS.md`, the banner says so every session until `/agent-kevin:upgrade` fixes it —
  the two states in which Claude Code would load nothing or load the manual twice.

### Changed
- `init` writes `AGENTS.md` and the `.claude/CLAUDE.md` bridge. A project's own
  `AGENTS.md` at the home root gets the manual appended; a root `CLAUDE.md` is no
  longer a collision, and `CLAUDE.local.md` as the manual's alternate location retires.
- `upgrade` maps both templates to their new homes (`AGENTS.md`, `.claude/CLAUDE.md`),
  runs the `0.4.0` migration before any template merge, refuses to proceed when the
  running server is older than the installed code, surfaces a user-global auto-mode
  block that predates `AGENTS.md` with paste-ready replacements, and no longer offers a
  seed template over a concept article the knowledge compile has taken over.
- The server resolves the manual wherever a home currently keeps it (`AGENTS.md`, the
  legacy root `CLAUDE.md`, or `CLAUDE.local.md`), so compile, seed import, and the
  session-start placeholder scan keep working between a plugin update and the home's
  upgrade.
- **Seed format: the operating-manual overlay travels as `AGENTS.md` only.** Bundles
  exported before 0.4.0 carry it as `CLAUDE.md` and are rejected by import; re-export
  them from a 0.4.0 plugin. Importing into a home not yet on the 0.4.0 layout still
  appends the overlay to its legacy manual.
- The status collector reads the `@-import` chain from the bridge and labels imports
  HOME-relative in the dashboard; `rename-agent` sweeps the bridge despite the
  dot-directory exclusion; seed-export, release, self-review, sync, configure-skills,
  setup-worktree, and the project skills name the new files. README and the printed
  auto-mode block follow: the Agent Knowledge Base allow and the Identity File
  Replacement soft-deny now name `AGENTS.md`.

### Upgrade
- `manual: none` — **restart Claude Code after `/plugin update`, before running this
  upgrade.** The MCP server changed; `upgrade` now compares `ping`'s `version` with the
  installed code and stops on a stale server instead of treating the migration as
  already applied.
- `script: required` — run `skills/upgrade/scripts/0.4.0.ts` via `run_upgrade`. Moves
  the manual from the root `CLAUDE.md` (or `CLAUDE.local.md`) to `AGENTS.md` and writes
  the `.claude/CLAUDE.md` bridge; retargets markdown links to the moved file; removes
  the legacy file. Backs up to `.kevin/updates/0.4.0-manual-<stamp>/`, rolls back on
  any verification failure, idempotent. Runs before any template merge.
- `template/AGENTS.md: mandatory` — the operating manual. Claude Code-only mechanics
  (`@-import` context loading, the auto-memory override, the plan-mode rule, the hook
  capture note) moved out to the bridge; section text is otherwise carried from the
  previous `CLAUDE.md` template.
- `template/CLAUDE.md: mandatory` — new file at `.claude/CLAUDE.md` (the Claude Code
  bridge). The migration writes it from this same template, so on a freshly migrated home
  this merge is a no-op; its `@-import` lines sit in the preamble, which section merges
  never touch.
- `template/knowledge/concepts/self-evolution-loop.md: optional` — two `CLAUDE.md` →
  `AGENTS.md` mentions (the prompt-evolution paragraph and the guardrails table).
- `manual: optional` — if you pasted the printed auto-mode block into
  `~/.claude/settings.json`, two of its rules changed: **Agent Knowledge Base** (allow)
  and **Identity File Replacement** (soft-deny) now name `AGENTS.md`. The upgrade checks
  your copy, prints the changed sentences and the exact replacement entries, and writes the
  same as a note to `.kevin/updates/automode-block.md`; paste each over the entry with the
  same name. Until
  refreshed, auto mode classifies every write to `AGENTS.md` (template merges,
  seed-import appends) as Instruction Poisoning and may prompt or block.
- `manual: none` — the migration retargets markdown links to the moved file and the one
  template sentence in `USER.md` that named it; every other mention of `CLAUDE.md` in
  operator-authored files is left as history. On the first session after upgrading, run
  `/context` and confirm `.claude/CLAUDE.md` lists its seven imports and no root
  `CLAUDE.md` remains.


## [0.3.33] - 2026-09-05

### Fixed
- **Session radar now works on Windows.** The default scope for `where-am-i`,
  `find-session`, and `standup` was assembled in the shell from `$PWD`, which Git Bash
  hands over in POSIX form (`/c/Users/...`) — the script then resolved it against the
  wrong drive and the radar came back empty. Both scripts (`list_sessions.ts`,
  `find_session.ts`) now build the default themselves from `process.cwd()` plus the
  `KEVIN_HOME`/`AGENT_HOME` and `KEVIN_CODE_PATH`/`AGENT_CODE_PATH` env vars, which
  reach a native process in native form. `--scope` still overrides.

### Changed
- The three skills that call the radar (`where-am-i`, `find-session`, `standup`) drop
  their shell scope preamble and just run the script; `--scope` is now an override, not
  a required argument.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.3.32] - 2026-09-01

### Changed
- **Seed manual overlay now targets `CLAUDE.md`, append-only and idempotent.**
  `CLAUDE.local.md` was the wrong destination — in this plugin it is the operating
  manual's alternate location for the init-collision case and compile reads it with
  priority, so a seeded overlay there would shadow the real manual. The seed format
  now allows the `CLAUDE.md` path and refuses `CLAUDE.local.md`; import appends the
  overlay section to the scaffolded manual (never replaces, never conflicts) and
  skips it when the identical section is already present, making re-import a full
  no-op.
- `/agent-kevin:seed-import` now offers to render a seeded roadmap draft
  (`knowledge/concepts/roadmap-draft.md`) via the roadmap skill.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.3.31] - 2026-08-31

### Added
- **Seed bundles: hand your agent to a teammate.** A one-shot export/import so an
  operator who has shaped their agent (renamed it, grown project knowledge, wired up
  custom skills and MCP servers) can give a teammate a starting point, while the
  teammate's memory, sessions, and credentials stay entirely their own. Two skills:
  `/agent-kevin:seed-export` runs a two-stage flow — an interview that builds the
  manifest (scope: whole agent / project slice with wikilink-driven concept discovery /
  identity only; identity; knowledge + surfaces; local setup beyond the scaffold; an
  optional CLAUDE.local.md overlay of curated operating-manual sections), then a
  per-file review gate over the actual bytes (approve / edit / exclude, scrub client
  names and personal paths — no approval, no bundle). `/agent-kevin:seed-import`
  overlays a bundle onto an initialized home with fork semantics: dry-run plan first,
  conflicts confirmed before overwriting, and it ends with the credential checklist the
  operator fills in their editor. Three MCP tools back them (`seed_scan`, `seed_export`,
  `seed_import` — the import runs outside the Bash sandbox so it can merge
  `settings.json` / `.mcp.json` and ensure the secrets store), plus a `kevin seed`
  CLI group for terminal use.
- **The bundle format (formatVersion 1)** is a plain zip: `manifest.json` + payload
  files under seed-allowed roots only (identity files, `knowledge/concepts/`,
  `projects/<slug>/{README.md,roadmap.html}`, `.claude/{skills,rules,assets}/`,
  root `roadmap.html`, `CLAUDE.local.md`). Setup travels as manifest fields —
  permission entries, MCP server entries, and credential key **names** — never values;
  the import plants empty placeholders and reports what to fill. Import verifies
  payload hashes and path containment before any write, refuses symlink payloads, and
  never clobbers existing MCP server names; credential-shaped keys can't ride the
  settings-env field on either side. The format accepts a minimal producer (manifest +
  identity files, generated anywhere), so bundles don't have to come from a home.

### Changed
- **`/agent-kevin:init` can start from a seed.** New Step 1c asks whether a seed bundle
  from a teammate exists; when the bundle carries identity, the persona steps take
  defaults instead of interviewing for prose the seed will overwrite (operator-facts
  steps always run in full), and after the scaffold init delegates to the seed-import
  flow automatically.
- README: new "Seed a teammate's agent from yours" use case, skills-table and CLI-table
  rows, and the MCP tool listing now counts 55 with the Seed group.

### Upgrade
- `settings: mandatory` — add to `permissions.allow`:
  `mcp__plugin_agent-kevin_kevin__seed_scan`, `mcp__plugin_agent-kevin_kevin__seed_export`,
  `Skill(agent-kevin:seed-export)`, `Skill(agent-kevin:seed-import)`; and add to
  `permissions.ask`: `mcp__plugin_agent-kevin_kevin__seed_import` (it overwrites identity
  files and merges permissions/MCP registrations from a foreign bundle, so it always
  confirms — same reasoning as `curl_run`).

## [0.3.30] - 2026-08-25

### Fixed
- **A planted data dir can no longer claim a directory as the agent home.** Before
  v0.3.28 the logger scaffolded `<cwd-fallback-home>/.kevin/logs/` just to record that
  session capture was skipping there, leaving bare `.kevin/` dirs in trees that were
  never homes; v0.3.28's marker move from SOUL.md to the data dir then armed those
  plants — the next session-end inside such a tree resolved it as the home and captured
  sessions into `<tree>/knowledge/`, lost to the brain. The home marker is now a state
  file only the agent's own flows write — `.kevin/version.json` (init/upgrade) or
  `.kevin/knowledge.json` (compile) — named once as `HOME_MARKER_FILES` so `isAgentHome`,
  the logger's file-output gate, and the test preload can't drift. Both files are
  git-tracked in a brain repo, so a fresh clone still resolves. The logger's gate also
  honors the runtime-dir migration window now, and the stranded-home messages stop
  prescribing `mkdir -p` (which no longer repairs anything) in favor of restoring the two
  state files. Regression tests pin the incident shape: a data dir holding only `logs/`
  neither anchors the walk-up nor re-arms file logging.

### Upgrade
- None — code-only, no bun install or HOME changes.

## [0.3.29] - 2026-08-20

### Added
- **Outbound checkpoint that survives auto mode.** Init now writes a baseline
  `permissions.ask` into project settings — `git push`, `gh pr create`/`merge`,
  `gh release create`, and the `curl_run` MCP tool always stop for a human, in every
  permission mode. Since Claude Code v2.1.228, eligible sessions start in **auto
  mode**, where a classifier model approves actions instead of prompting; `ask` rules
  are the one tier the classifier cannot approve past, which makes them the durable
  form of "nothing leaves this machine without a human". The list is deliberately
  short: prompt volume is what trains operators to blind-click.
- **Printed auto-mode guidance for the operator's user settings.** Kevin's memory
  lives in `knowledge/`, not the path auto mode's built-in memory exemption covers,
  so on shipped defaults the classifier can read a compile or memory write as
  *Instruction Poisoning*: the agent's core loop flagged as an attack. Init's summary
  now prints a copy-paste block for `~/.claude/settings.json` carrying an explicit
  `permissions.defaultMode: "auto"`, environment entries (an `Agent homes:` anchor
  with the home's real path interpolated at print time, plus an outbound-posture
  line), and two classifier `allow` sentences
  that treat the home's knowledge tree the way the built-in exceptions treat Claude's
  own memory directory. Every rule keys off that environment entry, so none of them
  depend on the classifier inferring which directory is an agent home, and the
  knowledge-base exception self-scopes to the home the session started in: an
  operator running two agents never grants one blanket rights over the other's
  identity files. The exemption names all three rules the built-in Memory Directory
  exception clears (Instruction Poisoning, Self-Modification, and Irreversible Local
  Destruction, the last being what would otherwise flag the compile loop's
  whole-article rewrites), and it is conditioned up front on content that neither
  changes permissions or auto-mode behaviour, fabricates consent, nor steers a future
  session toward a blocked action. `.claude/`, cross-home writes, content leaving the
  home, and directory-level deletion stay outside it. Print-only: Kevin never writes
  user-global settings.
- **Three classifier soft-denies ship in the same block**, because excluding
  something from an allow rule blocks nothing on its own: the classifier's default is
  ALLOW, so anything the allow rules decline to cover needs a deny to actually stop
  it. `Agent Home Outbound Push` covers pushes, PR creation and merges, and release
  publication from any agent-home session, and declares the built-in `Git Push
  Destination` exception inapplicable there; explicit user intent clears it, so
  naming the action and its destination is enough. Treat that one as defense in depth
  rather than the wall: a deny-side rule overriding a mandatory built-in exception is
  a precedence conflict the classifier resolves on its own, which is why the project
  `permissions.ask` list above stays the primary gate. `Identity File Replacement`
  catches what would otherwise be a git-recoverable overwrite matching no built-in
  rule: replacing, deleting, moving, or renaming an identity file, or editing away
  more than a small part of one. `Cross-Agent Home Write` stops a session in one
  agent home writing into another, however small the edit, since each agent's brain
  is read back as instructions by that agent's own future sessions. Mirroring between
  the agents' plugin repositories is untouched: those are code repositories, not
  homes.

### Changed
- **Upgrade gains two every-run invariants** (not gated on this entry, so homes that
  skip releases still converge): union any missing baseline `permissions.ask` entries
  into project settings (fail-soft: when the operator's sandbox protects
  `settings.json` from agent writes, surface the exact JSON as a `manual:` note
  instead), and print the user-global auto-mode block when `~/.claude/settings.json`
  has no `defaultMode` — the operator profile that reports permission-prompt fatigue.
  Silent when the operator has made any explicit mode choice.
- Init documents that `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (Kevin's own
  gap-filled quality default) disables feature-flag fetching and with it Claude
  Code's *built-in* auto-mode default — sessions silently start Manual with nothing
  on screen saying why. The explicit `defaultMode` line in the printed block is the
  fix; dropping the traffic kill is not required.
- **The upgrade skill is model-invocable.** A plain "upgrade kevin" or "apply the
  update" now reaches it — the operator doesn't have to know `/agent-kevin:upgrade`.
  No settings action: `Skill(agent-kevin:upgrade)` was already in the canonical
  grant list (kept latent so the slash form never prompted). Sync still surfaces the
  slash command instead of invoking it — upgrade chains sync at the end, so the
  reverse would recurse.

### Fixed
- **Stray `curl_run` allow grants are retired.** `curl_run` is the one sanctioned
  request-execution path in the `api-collections` skill and was never meant to be
  pre-granted — the whole point is that it always prompts. Some homes carry it in
  `permissions.allow` from earlier scaffolds or pack walks. The new `ask` entry
  outranks `allow`, so the gate holds either way, but the leftover grant is dead
  weight that misstates the home's audit trail (`settings.json` should read as an
  accurate record of what auto-approves). The upgrade offers the removal.

### Upgrade
- `settings: mandatory` — union the baseline `permissions.ask` list into project
  settings (outbound gates: push / PR create + merge / release / `curl_run`). The
  init skill's Step 7 list is the source of truth; applied by the upgrade's built-in
  invariant, so this line is documentation of what happened, not a separate action.
- `settings: optional` — remove `mcp__plugin_agent-kevin_kevin__curl_run` from
  `permissions.allow` when present: superseded by the `ask` entry above and contrary
  to the never-pre-granted doctrine. Removal, so ask first with the diff; skip
  silently when absent.
- `manual: optional` — paste the printed auto-mode block (`permissions.defaultMode`,
  the `Agent homes:` environment entry, two classifier `allow` sentences, two
  soft-denies) into `~/.claude/settings.json`, then restart sessions and verify the
  mode indicator says Auto. Keep `$defaults` in every array you set: omitting it
  replaces that whole default list, discarding built-in rules. Review the result with
  `claude auto-mode critique`, run from **outside** the agent home when that home
  sets `CLAUDE_CODE_OAUTH_TOKEN` (a per-agent token shadows the credential the
  subcommand needs, and the failure reads as an unrelated auth error). Reversible
  with `claude auto-mode reset`. Tradeoff stated in the printed note: the
  knowledge-tree exception lowers the classifier's Instruction Poisoning guard for
  the agent's own memory paths.

## [0.3.28] - 2026-08-20

### Added
- `standup` skill — your update in the three parts a standup actually has: what you
  did in the last 24h (merged PRs, prod actions run by hand, investigations that left
  no commit, tasks filed), what you're picking up next, and what's blocked with a
  named owner. Derived from git, PRs, session transcripts and the task board rather
  than asked for. Crosses the day boundary a standup does, flags older work a skipped
  run may have left unsaid, and stays glanceable while you're presenting.
  `/agent-kevin:standup 48` widens the window.
- `find-session` skill — locate a past session by *what it worked on* (a branch, a PR
  number, a worktree, a bug, a task id) and get its resume command back. Content
  search over all transcript history, ranked by did-the-work signals rather than hit
  count, so the session that merely mentioned a thing doesn't outrank the one that
  fixed it. The companion to `where-am-i`: that one answers *when*, this one *what*.
- README: **Running homes on different Claude accounts** — `CLAUDE_CODE_OAUTH_TOKEN`
  per home outranks the single `/login` slot, so two homes can bill two subscriptions
  at once. Covers minting with `claude setup-token`, why the token is the one
  credential that belongs in `settings.local.json`, and the five gotchas (switch
  `/login` between mints, restart to pick up the env block, launch from the home root,
  nothing higher-precedence shadowing it, verify with `/status` + `/usage`).

### Changed
- **Sync's briefing auto-select is catch-up-aware.** It used to read the clock alone,
  so a morning you never briefed silently became an evening brief at 3pm. Now it
  checks whether a morning brief actually ran today: none yet and it's 3am–9pm → a
  catch-up morning (even at 5pm); already ran, or past 9pm → evening. The header says
  which was picked and why.
- `where-am-i`'s description now points at `find-session` for content-shaped asks, so
  "which session was fixing X" routes to the right skill.

### Fixed
- **The session radar no longer trusts file mtimes for recency.** Claude Code touches
  open sessions' transcripts while they sit idle, so every live session read as "now"
  and a bulk touch (a `git checkout`, a backfill) could rank a stale session as the
  freshest. `minutes_ago` and the ordering now come from the transcript's last
  embedded record.

### Removed
- `permission-check` skill, and the `permissions` report category it was the only
  producer for — gone from the `report_write` enum, the dashboard's filter chips, and
  the orphan-file sweep. A home that already holds `reports/permissions/` files keeps
  them on disk and still lists any that made it into `reports/index.md`; they just
  lose their filter chip.

### Upgrade
- `settings: mandatory` — add to `permissions.allow`: `Skill(agent-kevin:find-session)`,
  `Skill(agent-kevin:standup)`. Both are model-invocable; without the grants Kevin
  raises a confirm prompt every time it fires them.
- `settings: optional` — `Skill(agent-kevin:permission-check)` is now a dead grant and
  can be dropped from `permissions.allow`. Harmless if left.

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
- `google-auth` tool gained a comment documenting the secrets-dir layout (parity with the worktree).

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
