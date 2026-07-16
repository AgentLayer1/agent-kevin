---
name: browser-flows
description: >
  Drive a website in a VISIBLE browser to run real, repeatable flows end to end —
  scrape a page into structured data, fill a form, or click through a multi-step
  task. Kevin opens a headed Chrome and (only when a flow needs it) waits for you
  to log in by hand — your real session, no API keys. Flows are pluggable, one
  folder each; `hacker-news` is the reference example. Manually invoked only — use
  /agent-kevin:browser-flows with plain instructions like "digest the top Hacker
  News stories" or by naming a flow.
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - mcp__plugin_agent-kevin_kevin__browser_flows
---

# browser-flows

Drive real browser flows as the operator, for automation and exploratory work. Each flow is a **folder** under `flows/` with an `index.ts` entry + `index.md` guidance, dispatched generically. Start from the **`hacker-news`** reference flow.

## Running a flow

Call the **`browser_flows`** MCP tool. It runs inside the MCP server process, so the headed browser launches *outside* the Bash sandbox (a `bun run` from a Bash call is blocked by the macOS seatbelt; the MCP server is not). Map the instruction to a flow + params:

```
browser_flows  flow=hacker-news  params={ count: 10 }
```

The window opens, the flow runs (pausing for a manual login only if its target has `auth`), then the tool returns the output tail + the flow's `index.md` as `guidance` — read it. Screenshots land in `reports/captures/browser/<env>/<flow>/<run>/`. Relay the `▸` lines and the final `✅`/`✗`.

If the headed browser ever fails to launch even from the server, fall back to a real terminal:
`NODE_PATH="$PWD/mcp-server/node_modules" PLAYWRIGHT_BROWSERS_PATH=0 KEVIN_HOME=<home> bun run skills/browser-flows/flows/<flow>/index.ts …`

### Flow params

Each flow declares its own params, defaults, and `targets` in `index.ts`'s header — **read `flows/<flow>/index.ts` + `index.md`** for the exact list, so adding or changing a flow never requires editing SKILL.md.

Harness-level params (every flow): `env` (target key), `confirm-prod` (required for guarded targets), and `headless: true` — runs without a window, reusing the persisted login. Headless can't *acquire* a session: if the login expired, it fails fast with "run once without --headless to log in".

### Test data & credentials — three inputs, one axis

The axis is **fixture vs secret**, not a single file. A flow reads from three places, in precedence order:

| Input | Where | For | Readable? |
|---|---|---|---|
| `--param` | the tool call | one-off overrides typed for a single run | yes — lands in the transcript |
| `.env` | `<HOME>/.claude/browser-flows/<flow>/.env` | **secrets** — real cards, passwords, tokens | **no** — deny-gated + gitignored |
| `config.json` | `<flow>/config.json` (beside `index.ts`) | **QA fixtures** — personas, scenarios, sandbox cards, defaults | yes — committed, agent-readable |

A flow resolves each field `params.x ?? process.env.SECRET ?? config.x ?? default`.

**config.json** is the everyday QA surface — structured test data you (and Kevin) can see and edit. Most sandbox QA lives entirely here; `.env` stays empty. The harness auto-loads it beside the flow's `index.ts` and hands it to the flow as `config` (declare a `Config` interface and call `runFlow<Config>(...)` for type safety). It's committed, so keep only non-secret fixtures in it.

**`.env`** is the thin secret overlay for the day a value must NOT be readable or committed (a real card against staging, a live password). The dispatcher loads it and injects it into **that flow's child alone** (scoped — one flow's secrets never reach another); the flow reads it from `process.env`. Values never pass through a param, never enter the conversation, and are unreadable by the agent's own Read/Bash. The run result lists the loaded key **names** only.

- `.env` is always in **HOME**, never the plugin repo — beside a HOME flow's `index.ts`, or a same-named folder holding just `.env` for a built-in flow. The loader **refuses** anything under `.kevin/secrets/`, so a flow can't reach Kevin's own operational keys (genuinely-shared secrets go in `.kevin/secrets/.env`, inherited by all flows and overridden by a flow's own `.env`).
- Ship a committed `.env.example` (the one `.env*` git tracks) listing the secret keys a flow expects; the real `.env` stays local.
- A flow author's one rule: read secrets from `process.env`, and **never `log()` a secret value** — flow stdout is captured into the result.

## Layout — portable core vs per-agent

`lib/` and the dispatcher are portable (mirror across agents); everything site-specific lives in `flows/<flow>/`.

| Portable | Per-agent / per-flow |
|---|---|
| `lib/browser.ts` — headed persistent launch, `ensureLoggedIn`, `step()`, the `Target` type | `flows/<flow>/index.ts` — entry, owning its `targets` (urls + optional `auth`) |
| `lib/flow.ts` — `runFlow(targets, handler)` harness (arg parse, env→target, launch, login-wait, cleanup) | `flows/<flow>/*.ts` — the flow's building blocks (e.g. `stories.ts`, `types.ts`) |
| `mcp-server/src/tools/browser-flows.ts` — generic folder dispatcher | `flows/<flow>/index.md` — guidance · `flows/<flow>/assets/` — upload templates |
| `BROWSER` group in `mcp-server/src/config.ts` | |

The dispatcher lists any `flows/<dir>/index.ts`. Compose a flow from small blocks so variants reuse the overlap. Screenshots are scoped per run under `reports/captures/browser/<env>/<flow>/<run>/`.

## Where flows live — built-in vs HOME-local

Flows resolve from two roots; a HOME flow **shadows** a built-in of the same name:

| Root | Path | For |
|---|---|---|
| Built-in | `skills/browser-flows/flows/<name>/` (this repo) | shipped, generic flows (e.g. `hacker-news`) |
| HOME-local | `<HOME>/.claude/browser-flows/<name>/` | private, per-operator flows — anything that drives a **specific or client app**; never distributed |

Put app-specific / client flows in **HOME**, not here — same principle as HOME skills and the memory tree. The only code difference: a HOME flow imports the shared harness as a **bare specifier** (the dispatcher puts `skills/browser-flows` on `NODE_PATH`):

```ts
import { runFlow } from 'lib/flow';          // HOME-local flow
import { log, type Target } from 'lib/browser';
```

Built-in flows use the relative form (`../../lib/flow`). Everything else — `targets`, `step()`, params, `index.md` — is identical. Bash fallback for a HOME flow adds the extra root:
`NODE_PATH="$PWD/mcp-server/node_modules:$PWD/skills/browser-flows" … bun run <HOME>/.claude/browser-flows/<flow>/index.ts …`

Editing an existing flow needs no restart (spawned fresh per run); **adding the HOME root or changing the dispatcher does** — restart the session so the MCP server reloads.

## Adding a flow

Create `flows/<name>/index.ts` (+ `index.md`) — no tool edit; the dispatcher discovers any folder with an `index.ts`. The entry owns its `targets` and composes blocks:

```ts
// flows/<name>/index.ts
import { runFlow } from '../../lib/flow';
import { type Target } from '../../lib/browser';

const TARGETS = { web: { name: 'web', appUrl: 'https://example.com' } } satisfies Record<string, Target>;

runFlow(TARGETS, async ({ params, target, session }) => {
  /* compose blocks from sibling ./*.ts modules; use step(session, 'label', fn) for captures */
});
```

Add `auth: { loginPath, homePath }` to a target when the flow logs in (then `runFlow` pauses for a manual login). Put reusable units in sibling modules; `index.md` is the guidance. See `flows/hacker-news/` as the reference.

## Selector tuning

Selectors are the only thing to retune when a site changes. On failure, `step()` writes `<step>-FAILED.png` + an aria snapshot to the run's capture dir. Read those, fix the locator (prefer `getByRole`/`getByLabel`), re-run — a persisted login (for auth flows) skips re-login.
