---
name: api-collections
description: Draft API requests as collection files the operator opens, visualizes, and fires in their API client (adapters — Bruno shipped, plain-curl fallback when nothing is installed). Use when the operator asks to create, draft, or update an API request, endpoint call, or request collection to try — "make me a request to test the webhook", "draft the activation API calls", "add this to my Bruno collection", or /api-collections. Authoring only — Kevin writes the files; the operator sends the requests from the client's GUI or terminal.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, mcp__plugin_agent-kevin_kevin__report_write, mcp__plugin_agent-kevin_kevin__curl_run
---

# API Collections

API clients that store collections as plain files on disk (no export step, no cloud) make authoring trivial: the file *is* the interface. You write a request file, it appears in the operator's client, they click **Send**. That's the whole loop. **You author, you never run.**

Each client is an **adapter** — a doc under `adapters/` owning that client's format, layout, and gotchas. Bruno is the shipped adapter. This SKILL.md owns everything client-agnostic: routing, location, secrets, and the standing rules.

## Route to an adapter

1. **Operator named a client** ("in Bruno", "as curl commands") → use that adapter.
2. **Otherwise detect what's installed** — check for Bruno, per platform:
   - macOS: `ls /Applications | grep -i Bruno || which bru`
   - Windows (pwsh): `where.exe bru` or `Test-Path "$env:ProgramFiles\Bruno\Bruno.exe", "$env:LOCALAPPDATA\Programs\bruno\Bruno.exe"`
   - Linux: `which bruno || which bru`
   Found → read [`adapters/bruno.md`](adapters/bruno.md) and follow it.
3. **Nothing recognized → fall back to [`adapters/curl.md`](adapters/curl.md), don't bail.** Every platform already has curl, so the skill is useful with nothing installed: author the requests as curl scripts, tell the operator exactly how to run them, and offer the Bruno install for a visual upgrade next time — macOS `brew install --cask bruno`; Windows `winget install -e --id Bruno.Bruno` (or `choco install bruno` / `scoop install bruno`); all platforms [usebruno.com/downloads](https://www.usebruno.com/downloads).

New adapters (Hurl, httpyac, Postman-format, …) are a new `adapters/<client>.md` — no changes here.

## Where collections live — resolve first

A collection is just a directory of files. **Resolve the target before writing:**

- **Operator named a location** (a path, "in the acme repo", "next to the code") → that directory is the collection root. Scaffold per the adapter if it's fresh; otherwise add to what's there.
- **No location given** → the default personal collection at `<HOME>/reports/api/<adapter>/` (`reports/api/bruno/`, `reports/api/curl/`, …). Each adapter owns its subfolder, so formats never mix; the `reports/api/` root itself stays reserved for the category's dated run logs and never holds collection files.
- Always tell the operator the resolved path so they can redirect.

| Placement | Where | For |
|---|---|---|
| Personal (default) | `<HOME>/reports/api/<adapter>/` | your own scratch/experiments — private HOME, apps as folders inside one collection per adapter |
| In-repo | inside a project (e.g. `<repo>/bruno/`) | requests committed + shared with a team. Make sure **that** repo's `.gitignore` covers `.env` before writing secrets. |

## Verifying a draft — `curl_run`

Authoring is run-free, but you may **verify** a draft (confirm it returns 201, debug a 4xx) with the **`curl_run`** MCP tool — the one sanctioned way to fire a request. It runs outside the Bash sandbox, loads the collection `.env`, interpolates `{{KEY}}` placeholders, and **scrubs every secret value back out** of the returned command + output, so what lands in the conversation is shareable (`Bearer {{ACME_API_KEY}}`). It's never pre-granted — every call prompts the operator, and you never run one unbidden.

- Pass curl args referencing secrets as `{{KEY}}` (never a literal): `curl_run args=["-X","POST","https://api.example.com/things","-H","authorization: Bearer {{ACME_API_KEY}}","-d","..."]`. Point `envFile` at the collection's `.env` when it isn't the default.
- Two honest limits to state when it matters: scrubbing covers **injected credentials only** — a response body can still hold sensitive API data; and it fires real requests at real systems, so offer it, don't assume it (especially against prod).

## Standing rules — every adapter, no exceptions

- **Never run requests unbidden.** Drafting writes files, full stop. The only execution path is `curl_run` above — an explicit, permission-prompted verification the operator approves. No shelling out to a client's CLI runner, no re-implementing a request in Bash.
- **Never pre-grant a client CLI** (e.g. `bru`) in any allowlist. If the operator ever explicitly asks for a headless run, the Bash call prompts — as it should.
- **Secrets never get literal values.** Reference them via the adapter's env indirection (Bruno: `{{process.env.KEY}}` + collection-root `.env`); you write `.env.example` listing key names, the operator fills `.env`. You **cannot** read `.env` (deny-gated) — by design, don't work around it.
- **Base URLs are variables, verified.** Requests use `{{baseUrl}}`-style vars defined per environment. Confirm each environment's URL from the repo/deploy config; if one isn't discoverable, use a `TODO(operator): confirm <env> URL` placeholder and say so — never guess a host.
- **Every request gets docs + checks.** A line or two of docs (what it does, what a good response looks like) and assertions/tests when the outcome is checkable, so the operator sees context and pass/fail in their client.
- **Clean up harness litter as your final step.** Writing files makes Claude Code's sandbox drop an empty `.claude/.cc-writes` staging dir beside them — after all writes, `rmdir` any `<collection-root>/**/.claude/.cc-writes` (and its parent `.claude`) so the handoff is clean.

## Log the drafting run

After authoring, write a short report (`report_write`, category `api`): title like `Bruno: <what you drafted>`, body = the resolved collection path, the requests added (in firing order), environments touched, and any `.env` keys the operator must fill. This is the dashboard's record of the run — the collection itself is the living artifact; the report is the outcome log.

## After authoring

Tell the operator, briefly:

1. The resolved collection root and which request(s) to try, in order.
2. Any first-time client step the adapter calls for (e.g. Bruno's one-time **Open Collection**).
3. If you added `.env.example` keys: copy to `.env` and fill values before sending.
