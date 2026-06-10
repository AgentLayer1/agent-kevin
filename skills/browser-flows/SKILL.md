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

## Layout — portable core vs per-agent

`lib/` and the dispatcher are portable (mirror across agents); everything site-specific lives in `flows/<flow>/`.

| Portable | Per-agent / per-flow |
|---|---|
| `lib/browser.ts` — headed persistent launch, `ensureLoggedIn`, `step()`, the `Target` type | `flows/<flow>/index.ts` — entry, owning its `targets` (urls + optional `auth`) |
| `lib/flow.ts` — `runFlow(targets, handler)` harness (arg parse, env→target, launch, login-wait, cleanup) | `flows/<flow>/*.ts` — the flow's building blocks (e.g. `stories.ts`, `types.ts`) |
| `mcp-server/src/tools/browser-flows.ts` — generic folder dispatcher | `flows/<flow>/index.md` — guidance · `flows/<flow>/assets/` — upload templates |
| `BROWSER` group in `mcp-server/src/config.ts` | |

The dispatcher lists any `flows/<dir>/index.ts`. Compose a flow from small blocks so variants reuse the overlap. Screenshots are scoped per run under `reports/captures/browser/<env>/<flow>/<run>/`.

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
