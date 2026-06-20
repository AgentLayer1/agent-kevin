---
name: configure-skills
description: Configure Kevin's optional skill packs (SEO, Browser, Database) or author a brand-new custom skill. The pack skills ship with the plugin and auto-load — this skill just wires up API keys, MCP server registrations, database connections, and tool permissions. Custom-authored skills land in `<HOME>/.claude/skills/<name>/`. Invoked at the end of /agent-kevin:init or any time after.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, AskUserQuestion, Bash(mkdir *), Bash(cat *), Bash(ls *), Bash(rm *), Bash(rmdir *), Bash(bunx skills *), Bash(test *), Bash(head *)
---

# Configure Skills

This skill manages Kevin's optional capabilities. Use it to:
1. **Configure a pack** (SEO, Browser, or Database) — writes API keys, registers MCP servers, sets up database connections, grants tool permissions
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
> - Configure a skill pack (SEO / Browser / Database)
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
> - ☐ Browser **(recommended)** — Perplexity research + Playwright tool permissions
> - ☐ Database — connect Kevin to one or more Postgres databases (read-only `db_list`/`db_schema`/`db_query` tools)
> - ☐ Third-party libraries — clone separately-authored skill libraries (e.g. SEO/GEO from `aaron-he-zhu`, marketing playbooks from `coreyhaines31`) into `<HOME>/.claude/skills/`. Apache-2.0 licensed.

If nothing is ticked, cancel and return to Step 1. Otherwise run the matching sub-section(s) below in order: SEO (A.2a) → Browser (A.2b) → Database (A.2c) → Third-party (Section F).

### A.2a — SEO pack walk

**Tool-name prefix convention** — important: the plugin bundles a single MCP server (`kevin`), so all its tools use the **plugin-namespaced** prefix `mcp__plugin_agent-kevin_kevin__<tool>` (e.g., `mcp__plugin_agent-kevin_kevin__serpapi_search`, `mcp__plugin_agent-kevin_kevin__web_search`). The shorter `mcp__kevin__<tool>` form looks correct but won't match anything at runtime — Claude Code prefixes plugin-provided servers with `plugin_<plugin-name>_<server-name>`. Tools from servers registered in `<HOME>/.mcp.json` (none required by Kevin's first-party packs) would use the plain `mcp__<server>__<tool>` form. The "Permissions to grant" column below uses the correct form for each.

| Skill | Backed by | Required key(s) | Extra permission to grant |
|---|---|---|---|
| `serpapi` | `mcp__plugin_agent-kevin_kevin__serpapi_search` | `SERPAPI_KEY` (https://serpapi.com) | _granted by this SEO walk_ |
| `open-page-rank` | `mcp__plugin_agent-kevin_kevin__open_page_rank` | `OPENPAGERANK_API_KEY` (https://openpagerank.com) | _granted by this SEO walk_ |
| `google-search-console` | `mcp__plugin_agent-kevin_kevin__gsc_*` | Google OAuth + `GSC_SITE_URL` | _granted by this SEO walk_ |
| `google-page-speed` | `mcp__plugin_agent-kevin_kevin__page_speed_*` | Google OAuth (shared with GSC) | _granted by this SEO walk_ |
| `wordpress-rest` | direct `curl` | none | `Bash(curl https://<host>/*)` + `Bash(curl * https://<host>/*)`, where `<host>` is derived from `GSC_SITE_URL`. Only granted if `google-search-console` was configured this run (so `GSC_SITE_URL` is set). Otherwise curl confirms per-call. |
| `google-search-audit` | composite (uses tools above) | shares the keys above | _granted by this SEO walk_ |

**`/agent-kevin:init` only pre-grants the always-on core MCP tools** — `ping`, `compile_*`, `task_*`, `links_rewrite`, `memory_prune`. The SEO-gated tools (`serpapi_search`, `open_page_rank`, `gsc_*`, `page_speed_*`, `google_auth`) land in `permissions.allow` only when this SEO walk runs, and only if the user activates the pack (no per-call confirm prompts after that).

The walk handles three concrete tasks per skill:
1. Add SEO-gated MCP tool grants to `$PROJECT_SETTINGS` → `permissions.allow` (§E).
2. Ensure empty env placeholders exist in `$SETTINGS_FILE` for `SERPAPI_KEY`, `OPENPAGERANK_API_KEY`, `GSC_SITE_URL` (§D — write `""` if absent; do **not** overwrite non-empty existing values).
3. Surface the Google OAuth file-drop flow (no value passes through chat).
4. If `GSC_SITE_URL` is set, add host-scoped curl grants for `wordpress-rest` (locked to the user's actual site, not blanket `Bash(curl *)`).

> **Never prompt for API key values in chat.** Even with the session-capture redaction hook, pasted keys touch the transcript and the Anthropic API. The walk surfaces *which keys are needed* and *where to fill them* (`<HOME>/.claude/settings.local.json` → `env` block); the user fills the value via editor. The session-capture redactor (exact-match against `settings.local.json` env values + known prefixes `pplx-…`, `sk-…`, `AIza…`) is a defense-in-depth net, not a license to ask.

Walk the 4 skills that *need keys* one at a time. For each, `AskUserQuestion`:

> **Activate `<skill-name>`?**
> Description: `<one-line summary from the SKILL.md frontmatter>`
> Requires: `<key name(s)>` — value goes in `.claude/settings.local.json` env block (you fill after init via editor)
>
> - Yes — grant tool permissions + ensure env placeholder exists
> - Skip (no permission grant, no placeholder)

If yes:
- For env-var keys (`SERPAPI_KEY`, `OPENPAGERANK_API_KEY`, `GSC_SITE_URL`): ensure key exists in `$SETTINGS_FILE` env block with empty-string value if missing (§D). Never overwrite a non-empty value. **Don't ask the user to paste the value.**
- For Google OAuth: walk the user through obtaining a client JSON, then placing it. Surface these steps verbatim:
  1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
  2. Pick (or create) a project. Under **Library**, enable the **Search Console API** and **PageSpeed Insights API**.
  3. **Credentials** → **Create Credentials** → **OAuth client ID** → application type **Desktop app** → Create → download the JSON.
  4. Move the file to `$HOME_DIR/.kevin/config/google-oauth-client.json` (`mkdir -p` the dir if missing).
  5. Set `GSC_SITE_URL` in `$SETTINGS_FILE` env block via editor.
  6. Inside Claude Code (after relaunch), run `mcp__plugin_agent-kevin_kevin__google_auth`. A browser tab opens, the user grants access, the refresh token is minted and persisted alongside the client JSON.

  After that, all `gsc_*` and `page_speed_*` tools work without re-prompting.

- Grant the matching MCP tool entries to `permissions.allow` via §E. Granular mapping:
  - `serpapi` → `mcp__plugin_agent-kevin_kevin__serpapi_search`
  - `open-page-rank` → `mcp__plugin_agent-kevin_kevin__open_page_rank`
  - `google-search-console` → `mcp__plugin_agent-kevin_kevin__gsc_inspect`, `gsc_query`, `gsc_sites`, `google_auth`
  - `google-page-speed` → `mcp__plugin_agent-kevin_kevin__page_speed_audit`, `page_speed_psi`, `google_auth` (deduped if GSC also chosen)

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
✅ SEO pack activated.

Tool permissions granted:  <list of MCP tools added to settings.json>
Env placeholders ready:    <list of empty keys in settings.local.json — fill these via editor>
                           SERPAPI_KEY, OPENPAGERANK_API_KEY, GSC_SITE_URL
Google OAuth:              <pending: drop client JSON to .kevin/config/google-oauth-client.json, then run `mcp__plugin_agent-kevin_kevin__google_auth` after relaunch>

Fill the values in <HOME>/.claude/settings.local.json — never paste them into chat.
```

### A.2b — Browser pack walk

The Browser pack has two pieces, each independently activatable:
1. **Perplexity** — grant `web_search` permission + ensure `PERPLEXITY_API_KEY` placeholder.
2. **Playwright + browser-flows** — grant `browser_{screenshot,pdf,record}` + `browser_flows` permissions (no key; Chromium runs locally).

Neither is pre-granted by `/init` anymore — they only land when the user activates the matching piece.

**(1) Perplexity** — `mcp__plugin_agent-kevin_kevin__web_search`.

`AskUserQuestion`:

> **Activate Perplexity search?**
> Adds `mcp__plugin_agent-kevin_kevin__web_search` to `permissions.allow` and ensures `PERPLEXITY_API_KEY` slot exists in `.claude/settings.local.json` env block. You fill the key value via your editor after this completes (sign up at https://perplexity.ai/settings/api). The tool stays callable but returns "missing env var" until you fill it.
>
> - Yes — grant permission + ensure placeholder
> - Skip (no permission grant, no placeholder)

If yes:
- Add `mcp__plugin_agent-kevin_kevin__web_search` to `permissions.allow` via §E.
- Ensure `PERPLEXITY_API_KEY: ""` exists in `$SETTINGS_FILE` env block via §D (only writes empty string if key is absent — never overwrites a non-empty existing value).
- **Do not** ask the user to paste the key value.
- **Do not** touch `$MCP_FILE` — `web_search` lives inside the `kevin` MCP server, not a separate project-registered server.

**(2) Playwright + browser-flows** — the `browser_{screenshot,pdf,markdown,record}` capture tools and `browser_flows` (runs pluggable browser flows in a visible browser; same bundled Chromium, no API key).

`AskUserQuestion`:

> **Activate Playwright + browser-flows?**
> Adds the browser capture tools and `browser_flows` to `permissions.allow`. No API key needed — Chromium runs locally from the plugin's bundled install.
>
> - Yes — grant permissions
> - Skip

If yes: add `browser_screenshot`, `browser_pdf`, `browser_markdown`, `browser_record`, and `browser_flows` to `permissions.allow` via §E.

Then verify the chromium binary is in place (the plugin's postinstall handles this):

```bash
bunx playwright --version 2>&1 || echo "PLAYWRIGHT_MISSING"
```

If `PLAYWRIGHT_MISSING`, tell the user:

```
Playwright isn't on the path — finish the plugin's initial install:
  cd ${CLAUDE_PLUGIN_ROOT}/mcp-server && bun install
If chromium download fails (macOS sandbox/XPC walls), run that command in a normal terminal outside Claude Code.
```

**Linux / WSL2 only — install the system libraries.** The chromium *binary* downloads fine, but on a fresh Linux distro (including WSL2) it links against system shared libs (`libnss3`, `libgbm1`, `libasound2`, …) that aren't installed by default and don't ship with the OS the way they do on macOS. Without them the binary is present but `chromium.launch()` fails at runtime with a missing-`.so` error. This step can't run in postinstall (it needs `sudo`), so on `wsl`/`linux` homes tell the user to run it once:

```
sudo ${CLAUDE_PLUGIN_ROOT}/mcp-server/node_modules/.bin/playwright install-deps chromium
```

(Skip this on macOS — the libraries are part of the OS there.)

After both pieces processed, print Browser pack summary.

### A.2c — Database pack walk

Connects Kevin to one or more Postgres databases. The `db_list`, `db_schema`, and `db_query` MCP tools (all read-only) are bundled with the plugin; this walk grants their permissions and sets up an **arbitrary number** of connections. Each connection is an env var `KEVIN_DB_<NAME>` whose value is a Postgres connection string. The connection string carries credentials, so it is **sensitive** — the walk only plants the empty placeholder key; the user fills the value in their editor, never in chat.

> **Never prompt for connection-string values in chat.** A Postgres URL embeds a password (`postgres://user:pass@host/db`). The walk collects connection *names* only and surfaces *which* `KEVIN_DB_<NAME>` keys to fill in `<HOME>/.claude/settings.local.json` → `env`. The session-capture redactor masks DB URLs as defense-in-depth, but the safe move is to keep the value off the wire entirely.

**(1) Grant the db tool permissions.** Add all three to `permissions.allow` via §E (read-only, so granting them together is fine):
- `mcp__plugin_agent-kevin_kevin__db_list`
- `mcp__plugin_agent-kevin_kevin__db_query`
- `mcp__plugin_agent-kevin_kevin__db_schema`

**(2) Collect connection names.** `AskUserQuestion` (or free-text):

> **Which databases do you want to connect?**
> Give each a short connection name (lowercase, e.g. `app`, `analytics`, `local`). You can list several comma-separated, and add more later by re-running this walk. The name is just a label — you'll paste the actual connection string into your editor afterward.

For each name the user gives:
- Normalize it the way the tool resolves connections: upper-case and replace every non-alphanumeric character with `_`, then prefix `KEVIN_DB_`. So `analytics` → `KEVIN_DB_ANALYTICS`, `read-replica` → `KEVIN_DB_READ_REPLICA`. (This matches `envKeyFor` in the plugin's `mcp-server/src/tools/database.ts`; the tool lowercases the suffix back to the connection name.)
- Plant the placeholder via §D "ensure placeholder" — `env[KEVIN_DB_<NAME>] = ""` only if absent. **Never overwrite a value the user already filled** (re-running to add a connection is safe).

If the user adds zero connections, still grant the tool permissions and note that `db_list` will report none until they add a `KEVIN_DB_<NAME>` env var.

**(3) Summary:**

```
✅ Database pack activated.

Tool permissions granted:  db_list, db_query, db_schema  (read-only)
Connection placeholders:   KEVIN_DB_<NAME1>, KEVIN_DB_<NAME2>  (empty — fill these via editor)

Each placeholder takes a Postgres connection string, e.g.:
  "KEVIN_DB_APP": "postgres://user:pass@localhost:5432/app_dev"

Fill the values in <HOME>/.claude/settings.local.json — never paste them into chat.
Relaunch Claude Code, then run db_list to confirm Kevin sees them.
Add more connections any time by re-running this walk.
```

---

## Section F — Install third-party skill libraries

The plugin ships AgentLayer-authored skills only. For community-maintained skill libraries, defer to **[skills.sh](https://skills.sh)** — a cross-agent skill registry (Claude Code, Codex, Cursor, Copilot, Windsurf) maintained by Vercel Labs. One CLI, registry-tracked versions, symlink-based installs so upstream updates propagate automatically.

The install command is:

```bash
cd "$HOME_DIR"
bunx skills add <owner/repo> -a claude-code -y
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
cd "$HOME_DIR" && bunx skills add <owner/repo> -a claude-code -y
```

Capture the CLI's output. On success it lists the skills it installed and the destination paths. On failure (network, cache permission, missing repo) — surface the error to the user, suggest manual `bunx skills list <owner/repo>` to verify the repo + permissions, and move on to the next ticked library.

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

- **Update an installed library**: re-run `bunx skills add <owner/repo> -a claude-code -y` from `$HOME_DIR`. skills.sh pulls latest upstream into its cache; the symlink in `<HOME>/.claude/skills/` keeps pointing at the same path, so the freshness shows immediately.
- **Uninstall a library**: `bunx skills remove <owner/repo> -a claude-code` (if supported), or fall back to deleting the symlinks: `rm "$HOME_DIR/.claude/skills/<skill-name>"`. The skills.sh cache stays; that's fine — it's reusable.
- **List installed**: `bunx skills list` from `$HOME_DIR`.

### F.5 Trust model

> By installing a third-party library you're accepting that its skill bodies execute in your session with your `permissions.allow` grants. skills.sh maintains a leaderboard and metadata but does not vet skill behavior. Treat each `bunx skills add` like a package install — read the LICENSE, scan the SKILL.md files, prefer libraries that pin versions / have active maintenance.

### F.6 Summary

Print per library: install status + symlink path + upstream LICENSE first-line. Remind the user the symlink means upstream changes flow through on next `bunx skills add` of the same repo (or whenever skills.sh's CLI runs its update cycle).

---


## Section C — Deconfigure a skill pack

### C.1 Pick pack to deconfigure

`AskUserQuestion`:

> **Which pack's configuration to remove?**
> - SEO (clears API keys + permissions; skill files stay loaded but tool calls will error)
> - Browser (removes the Perplexity API key; the MCP server stays plugin-bundled but goes inert without the key. Playwright tools stay since they're built-in)
> - Database (revokes the db tool permissions; optionally removes the `KEVIN_DB_*` connection keys)

### C.2 Deconfigure actions

**SEO deconfigure:**
- Revoke SEO-gated MCP tool grants from `$PROJECT_SETTINGS` → `permissions.allow` (§E remove helper): `serpapi_search`, `open_page_rank`, `gsc_inspect`, `gsc_query`, `gsc_sites`, `page_speed_audit`, `page_speed_psi`, `google_auth`. These were added by the SEO activation walk; the always-on core (`ping`, `compile_*`, `task_*`, `links_rewrite`, `memory_prune`) stays.
- Revoke any `Bash(curl https://<host>/*)` or `Bash(curl * https://<host>/*)` entries — those were the host-scoped curl grants written when SEO was activated. To know which host, read `GSC_SITE_URL` from `$SETTINGS_FILE` before deciding (next step) and normalise the same way the configure flow did. If `GSC_SITE_URL` is already empty, fall back to scanning `permissions.allow` for any `Bash(curl *)` entry and ask the user before removing.
- `AskUserQuestion`: "Also remove `SERPAPI_KEY`, `OPENPAGERANK_API_KEY`, `GSC_SITE_URL` from `$SETTINGS_FILE`?" (Yes/No)
- If yes: read `$SETTINGS_FILE`, delete those keys from `env`, write back.

**Browser deconfigure:**
- Revoke Browser-gated MCP tool grants from `permissions.allow` (§E remove helper): `web_search`, `browser_screenshot`, `browser_pdf`, `browser_markdown`, `browser_record`, `browser_flows`. Always-on core stays.
- `AskUserQuestion`: "Remove `PERPLEXITY_API_KEY` from `$SETTINGS_FILE`?" (Yes/No). If yes, delete via §D.
- Do **not** touch `$MCP_FILE` — `web_search` lives inside the `kevin` MCP server, not a project-registered server.
- Remind user: playwright + chromium stay installed (part of plugin base deps); only the permission grants get removed.

**Database deconfigure:**
- Revoke the db tool grants from `permissions.allow` (§E remove helper): `db_list`, `db_query`, `db_schema`. Always-on core stays.
- Read `$SETTINGS_FILE` and scan `env` for keys matching `KEVIN_DB_*`. List them back to the user (names only, never the values).
- `AskUserQuestion`: "Also remove these `KEVIN_DB_*` connection keys from `$SETTINGS_FILE`?" (Yes / No). If any key holds a non-empty value, warn that removing it discards a connection string the user pasted. If yes, delete the matched keys from `env` via §D and write back. If no, leave them (they're harmless once the perms are revoked).

Print summary of what was removed.

---

## Section D — Helper: write keys to `settings.local.json`

Two variants — **ensure placeholder** (used by pack activation walks) vs. **set value** (only used when migrating an existing config; **never** in response to a chat paste).

**Ensure placeholder** (`KEY` exists with empty-string value if missing):

1. Read `$SETTINGS_FILE`. If it doesn't exist, start with `{}`.
2. Ensure `env` is an object — initialize if missing.
3. If `env[KEY]` is **undefined**, set `env[KEY] = ""`. If it exists with **any** value (even empty), do nothing.
4. Write back with 2-space indent.

This is what every pack activation walk uses — it never overwrites a value the user already filled, and never solicits a value via chat.

**Set value** (used only for non-secret migrations, sanitized inputs):

1–2. Same as above.
3. Set `env[KEY] = value`. Use only when the value did not pass through the chat transcript.
4. Write back.

Example final shape — what the user fills via their editor after pack activation:

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

Example final shape — `/init` always-on baseline + both SEO and Browser activated, with SEO setting `GSC_SITE_URL=https://example.com/`. `/init` writes the core Bash patterns, the always-on `kevin` MCP entries, and the core skill grant (`setup-worktree`); this skill appends the pack-gated MCP entries (SEO, Browser) and the host-scoped curl pair when SEO's `GSC_SITE_URL` is set:

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
      "mcp__plugin_agent-kevin_kevin__browser_flows",
      "mcp__plugin_agent-kevin_kevin__browser_markdown",
      "mcp__plugin_agent-kevin_kevin__browser_pdf",
      "mcp__plugin_agent-kevin_kevin__browser_record",
      "mcp__plugin_agent-kevin_kevin__browser_screenshot",
      "mcp__plugin_agent-kevin_kevin__capture",
      "mcp__plugin_agent-kevin_kevin__compile_next",
      "mcp__plugin_agent-kevin_kevin__compile_status",
      "mcp__plugin_agent-kevin_kevin__compile_write",
      "mcp__plugin_agent-kevin_kevin__dashboard",
      "mcp__plugin_agent-kevin_kevin__google_auth",
      "mcp__plugin_agent-kevin_kevin__gsc_inspect",
      "mcp__plugin_agent-kevin_kevin__gsc_query",
      "mcp__plugin_agent-kevin_kevin__gsc_sites",
      "mcp__plugin_agent-kevin_kevin__knowledge_lint",
      "mcp__plugin_agent-kevin_kevin__links_rewrite",
      "mcp__plugin_agent-kevin_kevin__memory_prune",
      "mcp__plugin_agent-kevin_kevin__open_page_rank",
      "mcp__plugin_agent-kevin_kevin__page_speed_audit",
      "mcp__plugin_agent-kevin_kevin__page_speed_psi",
      "mcp__plugin_agent-kevin_kevin__ping",
      "mcp__plugin_agent-kevin_kevin__report_write",
      "mcp__plugin_agent-kevin_kevin__serpapi_search",
      "mcp__plugin_agent-kevin_kevin__setup_worktree",
      "mcp__plugin_agent-kevin_kevin__task_close",
      "mcp__plugin_agent-kevin_kevin__task_create",
      "mcp__plugin_agent-kevin_kevin__task_get",
      "mcp__plugin_agent-kevin_kevin__task_query",
      "mcp__plugin_agent-kevin_kevin__task_scan",
      "mcp__plugin_agent-kevin_kevin__task_thread",
      "mcp__plugin_agent-kevin_kevin__task_update",
      "mcp__plugin_agent-kevin_kevin__web_search",
      "Skill(agent-kevin:setup-worktree)"
    ]
  }
}
```

**Prefix rule** (use this whenever you need to know how a tool surfaces to permissions.allow):
- Plugin-bundled MCP tools (from the plugin's own `.mcp.json` → any `mcpServers.<name>`): `mcp__plugin_agent-kevin_<server>__<tool>`. The plugin bundles a single server: `kevin` (25 tools, including `web_search` which wraps the Perplexity Search API).
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
