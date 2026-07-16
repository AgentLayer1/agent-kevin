# Adapter: Bruno

Bruno stores collections as plain files on disk — hand-writing them IS Bruno's official agent workflow. Bruno ships no CLI/MCP/SDK that creates requests (`bru` only *runs* and *imports*); their answer to "how does an AI make requests" is a context prompt-pack that teaches the format. This adapter vendors it.

Bruno runs on macOS, Windows, and Linux — the collection files are identical everywhere; only install/detection differ. Install: macOS `brew install --cask bruno`; Windows `winget install -e --id Bruno.Bruno` (or `choco install bruno`, `scoop install bruno` from the extras bucket); Linux + everything else at [usebruno.com/downloads](https://www.usebruno.com/downloads). On Windows, author paths with `node:path`-style joins, never hardcoded separators, and quote paths with spaces in any command you surface.

## Format — read this first

**Read [`../references/bruno-ai-context.md`](../references/bruno-ai-context.md) before authoring anything.** It's Bruno's official AI-assistant context (from [bruno-collections/ai-assistant-prompts](https://github.com/bruno-collections/ai-assistant-prompts)) and is the authoritative spec for every block, field, auth type, test convention, and the JS runtime API. This adapter only adds layout and gotchas; the context file owns the syntax.

The one thing that must never waver: **OpenCollection YAML** (`.yml`), Bruno's default since v3.1 — never the legacy `.bru` format. Mixing `.bru` files under an `opencollection.yml` marker makes Bruno hide them (a real trap we hit). Go full YAML: `opencollection.yml` + `.yml` request files, `info:` (not `meta:`), tests under `runtime: scripts:` with type `tests`.

## Collection layout

One collection per root; apps/clients are **folders inside it**, so the operator opens the collection once and everything ever drafted shows up under it.

```
<collection-root>/            # reports/api/bruno/ (default)  OR  <repo>/bruno/  OR  wherever resolved
├── opencollection.yml        # collection root — REQUIRED, or Bruno won't index it
├── .env                      # real secrets — operator-owned, gitignored, unreadable to you
├── .env.example              # committed key names, no values
├── environments/
│   └── default.yml           # variables: list (baseUrl, …)
└── <app>/                    # a folder groups related requests (scratch, acme, …)
    ├── folder.yml            # info: { name: <app> }
    └── Create thing.yml      # request file — filename = request name (spaces ok)
```

`opencollection.yml` for a fresh collection — the `ignore` list keeps Bruno from surfacing junk (notably `.claude`, the harness's write-staging dir):

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

## Bruno-specific rules

- **Secrets**: reference as `{{process.env.KEY}}` in environment files; Bruno auto-loads the collection-root `.env`. (`secret: true` env vars are the GUI-managed alternative; the `.env` route is what keeps values off your side.) Two soft-failure traps: Bruno reads `.env` at **collection-open**, so a freshly created one needs a reload; and an **unresolved** placeholder is sent as the literal string `{{process.env.KEY}}`, which a permissive endpoint will accept (a false green). So a secret-bearing request's test should assert the value actually **resolved** — e.g. `expect(res.body.token).to.not.match(/\{\{|process\.env/)` — not just that auth passed.
- **Environments are collection-wide** — if two apps need different hosts, give them distinct var names (`acmeBaseUrl`) or folder-scoped variables (see the context file's variable scopes); don't over-engineer it.
- **Tests** are Chai assertions under `runtime: scripts:` with `type: tests` — the GUI shows pass/fail on Send. **Chain** with `bru.setVar` in an `after-response` script when a sequence needs it (login stores `{{token}}`, later requests use it).
- **`seq` orders requests** within a folder — number them in the order the operator should fire them.
- **Docs** render in the GUI: `docs:` block with `type: text/markdown`.
- Bruno watches the folder: new or edited files appear in an open collection without re-importing. **Exception:** changing the collection's root marker (adding/removing `opencollection.yml`) needs a collection reload (remove + re-open in Bruno).
- **A malformed request `.yml` vanishes silently** — Bruno drops any file it can't parse from the sidebar with no error, so a request that "doesn't show up" almost always has broken YAML (usual culprits: a duplicate key, a tab, wrong indentation). **Parse-check every file you write** before handing off — don't trust that it rendered. `ruby -ryaml -e 'YAML.load_file(ARGV[0])' "<file>"` (mac/Linux) is a quick gate; if a request is missing after a reload, that's the first thing to check.

## Flows — multi-step chains (sign-in → onboarding → checkout → activation)

A flow is a **folder of ordered requests that carry values forward** — built entirely on **native Bruno features** (`bru.setVar`/`getVar`, `after-response` scripts, `seq` ordering, the Runner), all documented in the vendored `../references/bruno-ai-context.md`. Nothing custom, nothing chained through Kevin: **Kevin authors the folder; the operator runs it in the Bruno app's Runner.** (`curl_run` is single-request verification only — never a flow runner.) Be fluent at composing these; model them, don't invent machinery:

- **One folder per flow** (`<app>/checkout/`), requests numbered by `seq` in run order.
- **Carry values forward** with `bru.setVar` in an `after-response` script; later requests read them as `{{var}}`. A sign-in stores the token/cookie; onboarding stores the created id; checkout reads both.

```yaml
# 1 Sign in.yml
runtime:
  scripts:
    - type: tests
      code: test("ok", () => expect(res.status).to.equal(200));
    - type: after-response
      code: |-
        bru.setVar("sessionToken", res.body.token);
        bru.setVar("memberId", res.body.member.id);
```
```yaml
# 2 Create line.yml — consumes what step 1 stored
http:
  method: POST
  url: "{{baseUrl}}/api/member/{{memberId}}/lines"
  headers:
    - name: authorization
      value: "Bearer {{sessionToken}}"
```

- **Run the whole flow** in Bruno's **Runner** (folder → Run) — it executes in `seq` order, passing runtime vars along; each step's tests gate the next. Individual requests still work standalone for debugging.
- **`seq` is the contract** — a gap or dup breaks ordering; number densely (1, 2, 3…).
- **Guard preconditions** in an early request's test (`expect(bru.getVar("sessionToken")).to.be.a("string")`) so a mid-flow failure reads clearly instead of cascading 401s.
- **Don't over-spec**: a flow is just numbered requests + `setVar`. Reach for `bru.setNextRequest(name)` (see the context file) only for genuinely conditional branching, not linear steps.

Common flows to model this way: **sign-in, onboarding, checkout, submission, activation** — each a folder, each step gated by its own tests.

## First-time operator steps

Fresh collection: scaffold `opencollection.yml`, `environments/default.yml`, and `.env.example`, then tell the operator to **Open Collection** in Bruno once, pointing at the collection root (if the path has a dot-folder segment, note it's hidden in the macOS dialog — Cmd+Shift+. reveals it). After that, edits are live.
