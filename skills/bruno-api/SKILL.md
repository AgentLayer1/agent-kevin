---
name: bruno-api
description: Draft API requests as a Bruno collection the operator opens and fires in the Bruno app. Use ONLY when the operator explicitly mentions Bruno — e.g. "make a Bruno request for the webhook", "add this to my Bruno collection", "draft it in Bruno", or /bruno-api. Do NOT trigger on generic API/curl/endpoint talk that doesn't name Bruno. Authoring only — Kevin writes OpenCollection YAML into <HOME>/.claude/api/; the operator sends the requests from the Bruno GUI.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Bruno API

Bruno stores collections as plain files on disk — no export step, no cloud. The file *is* the interface: when you write a request file, it appears in the operator's Bruno sidebar; they click **Send**. That's the whole loop. **You author, you never run.**

Hand-writing the files IS Bruno's official agent workflow — Bruno ships no CLI/MCP/SDK that creates requests (`bru` only *runs* and *imports*). Their answer to "how does an AI make requests" is a context prompt-pack that teaches the format so the assistant writes the files. This skill vendors that pack (see `references/`).

## Format — read this first

**Read [`references/bruno-ai-context.md`](references/bruno-ai-context.md) before authoring anything.** It's Bruno's official AI-assistant context (from [bruno-collections/ai-assistant-prompts](https://github.com/bruno-collections/ai-assistant-prompts)) and is the authoritative spec for every block, field, auth type, test convention, and the JS runtime API. This SKILL.md only adds Kevin-specific policy on top; the context file owns the syntax.

The one thing that must never waver: **OpenCollection YAML** (`.yml`), Bruno's default since v3.1 — never the legacy `.bru` format. Mixing `.bru` files under an `opencollection.yml` marker makes Bruno hide them (a real trap we hit). Go full YAML: `opencollection.yml` + `.yml` request files, `info:` (not `meta:`), tests under `runtime: scripts:` with type `tests`.

## Preconditions — fail fast

Before authoring, confirm Bruno exists:

```
ls /Applications | grep -i Bruno || which bru
```

If neither the app nor the CLI is present, **stop** — don't scaffold into the void. Tell the operator: `brew install --cask bruno` (macOS) or [usebruno.com/downloads](https://www.usebruno.com/downloads).

Two standing rules, no exceptions:

- **Never run requests.** No `bru run`, no curl re-implementation of a request you authored. The operator fires requests in the GUI.
- **Never pre-grant `bru`.** Don't add it to any allowlist. If the operator ever explicitly asks for a headless run, the Bash call prompts — as it should.

## Where the collection lives — resolve first

A collection is just a directory with an `opencollection.yml`. **Resolve which directory before writing:**

- **Operator named a location** (a path, "in the acme repo", "next to the code") → that directory is the collection root. Scaffold it (below) if it has no `opencollection.yml`; otherwise add to what's there.
- **No location given** → fall back to the default personal collection at `<HOME>/.claude/api/`.
- Always tell the operator the resolved path so they can redirect if it's not what they meant.

Two placements, identical mechanics:

| Placement | Where | For |
|---|---|---|
| Personal (default) | `<HOME>/.claude/api/` | your own scratch/experiments — private, gitignored HOME, never in the plugin repo (same principle as HOME browser flows). One collection, apps as **folders inside it**. |
| In-repo | inside a project (e.g. `<repo>/bruno/`) | requests committed + shared with a team. Make sure **that** repo's `.gitignore` covers `.env` before writing secrets. |

A collection root, whichever placement:

```
<collection-root>/            # .claude/api/  OR  <repo>/bruno/  OR  wherever the operator said
├── opencollection.yml        # collection root — REQUIRED, or Bruno won't index it
├── .env                      # real secrets — operator-owned, gitignored, unreadable to you
├── .env.example              # committed key names, no values
├── environments/
│   └── default.yml           # variables: list (baseUrl, …)
└── <app>/                    # a folder groups related requests (scratch, acme, …)
    ├── folder.yml            # info: { name: <app> }
    └── Create thing.yml      # request file — filename = request name (spaces ok)
```

`opencollection.yml` for the collection — the `ignore` list keeps Bruno from surfacing junk (notably `.claude`, the harness's write-staging dir that reappears whenever Kevin writes into the folder):

```yaml
opencollection: 1.0.0

info:
  name: Agent Kevin

extensions:
  bruno:
    ignore:
      - node_modules
      - .git
      - .claude
```

## Authoring rules

- **Base URLs are variables.** Requests use `{{baseUrl}}`; `environments/<env>.yml` defines it. Never hardcode a host in a request file. Environments are collection-wide — if two apps need different hosts, give them distinct var names (`acmeBaseUrl`) or folder-scoped variables (see the context file's variable scopes); don't over-engineer it.
- **Verify every base URL against the repo/deploy config — never invent a host.** Read the app's env config to confirm each environment's URL (a `localhost` port, a real domain). If one isn't discoverable (e.g. a staging host that only lives in the deploy dashboard), leave a `TODO(operator): confirm staging URL` placeholder and say so — a guessed domain silently fails or, worse, hits the wrong system.
- **Secrets never get literal values.** Reference them as `{{process.env.KEY}}` in environment files; Bruno auto-loads the collection-root `.env`. You write `.env.example` listing key names; the operator copies it to `.env` and fills values. You **cannot** read `.env` (deny-gated) — that's by design, don't work around it. (`secret: true` env vars are the GUI-managed alternative; the `.env` route is what keeps values off your side.)
- **Every request gets a `docs:` block** — a line or two: what it does, what a good response looks like. The operator is visualizing; give them context in the GUI.
- **Add a `tests` script** when the outcome is checkable (status, a field's presence/type) — Chai assertions under `runtime: scripts:` with `type: tests`, so the GUI shows pass/fail on Send.
- **Chain with `bru.setVar`** in an `after-response` script when a sequence needs it (login stores `{{token}}`, later requests use it).
- **`seq` orders requests** within a folder — number them in the order the operator should fire them.
- Bruno watches the folder: new or edited files appear in an open collection without re-importing. **Exception:** changing the collection's root marker (adding/removing `opencollection.yml`) needs a collection reload (remove + re-open in Bruno).
- **Clean up harness litter as your final step.** Writing files makes Claude Code's sandbox drop an empty `.claude/.cc-writes` staging dir in the collection. The `ignore` list hides it when Bruno re-scans, but Bruno's live watcher surfaces it until the operator reloads — so after all your writes, `rmdir` any `<HOME>/.claude/api/**/.claude/.cc-writes` (and its parent `.claude`) so the handoff is clean. It's empty and gitignored; never anything to inspect.

## Scaffolding a fresh collection

When the resolved root has no `opencollection.yml`: scaffold `opencollection.yml` (with the `ignore` list above), `environments/default.yml`, and a `.env.example`, then tell the operator to **Open Collection** in Bruno once, pointing at that root (if it's under `.claude`, note the folder is hidden in the macOS dialog — Cmd+Shift+. reveals it). After that, edits are live.

## After authoring

Tell the operator, briefly:

1. The resolved collection root and which request(s) to try, in order.
2. First time / after a root-marker change: **Open Collection** → the collection root, then pick the environment (top-right).
3. If you added `.env.example` keys: copy to `.env` and fill values before sending.
