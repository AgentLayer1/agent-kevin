# Adapter: curl (universal fallback)

The zero-install adapter. Every platform this skill runs on already has `curl` (macOS, Linux, Windows 10+ all ship it), so when no API client is recognized, requests are authored as plain curl scripts the operator runs from their terminal. Same contract as every adapter: **you author, you never run.**

## Output — one script per app, matched to the operator's platform

- **macOS / Linux:** `<collection-root>/<app>/requests.sh` (bash)
- **Native Windows:** `<collection-root>/<app>/requests.ps1` (PowerShell 7+, using `curl.exe`)

Default collection root: `<HOME>/reports/api/curl/` — never inside another adapter's collection (a `.sh` in a Bruno collection is junk to Bruno).

One request per numbered block, in firing order. Variables at the top; docs as comments (what it does, what a good response looks like) — the comment IS the docs block here.

`requests.sh`:

```bash
#!/usr/bin/env bash
# acme API requests — run all: bash requests.sh · or copy any single command
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3001}"
# Secrets come from the environment — fill <collection-root>/.env and load it:
#   set -a; source ../.env; set +a

# 1. Health check — expect 200 {"status":"ok"}
curl -sS "$BASE_URL/api/health"

# 2. Create thing — expect 201 with the new id
curl -sS -X POST "$BASE_URL/api/things" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${ACME_API_KEY:?fill .env and source it}" \
  -d '{"name":"example"}'
```

`requests.ps1` (Windows):

```powershell
# acme API requests — run all: pwsh -File requests.ps1 · or copy any single command
$BaseUrl = if ($env:BASE_URL) { $env:BASE_URL } else { "http://localhost:3001" }

# 1. Health check — expect 200 {"status":"ok"}
curl.exe -sS "$BaseUrl/api/health"

# 2. Create thing — expect 201 with the new id
curl.exe -sS -X POST "$BaseUrl/api/things" `
  -H 'content-type: application/json' `
  -H "authorization: Bearer $env:ACME_API_KEY" `
  -d '{"name":"example"}'
```

## Rules

- **Portable flags only**: `-sS`, `-X`, `-H`, `-d`, `--data-urlencode`. No `--json` (needs curl ≥7.82), no file-writing flags (responses print to stdout), and no shell-specific tricks beyond the line continuations shown.
- **Secrets stay env vars** (`${KEY}` / `$env:KEY`) resolved from the collection `.env` — never a literal value in the script. Bash gets the `set -a; source ../.env; set +a` hint; on Windows tell the operator to set the vars in their session (or fill the `$env:` values by hand) before running.
- **On Windows, always `curl.exe`**, never bare `curl` — Windows PowerShell 5.1 aliases `curl` to `Invoke-WebRequest`, which breaks every flag. Line continuation is a backtick, not a backslash, and single commands must be one line in `cmd.exe`.
- No assertions engine here — instead put the expected status/shape in each block's comment so the operator can eyeball the response.

## Tell the operator how to run

Always close with the exact run commands for their platform:

- macOS/Linux: `bash <collection-root>/<app>/requests.sh` — or copy any single `curl` block into the terminal.
- Windows: `pwsh -File <collection-root>\<app>\requests.ps1` — or copy any single `curl.exe` command into PowerShell / Command Prompt (one line in cmd).

And mention once: installing Bruno later upgrades these same drafts into a visual collection — the skill re-routes automatically when it detects it.
