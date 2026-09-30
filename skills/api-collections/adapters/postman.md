# Adapter: Postman

Postman v12 reads collections straight from disk: its **Native Git** mode (the desktop app's **Local View**) keeps every request as its own YAML file under a `postman/` folder, and edits made outside the app, by an IDE or an agent, are a supported workflow. So the loop is the same as Bruno's: you write a request file, it appears in the operator's Postman, they click **Send**. Postman's own agent answer is a skill that teaches the file format; this adapter carries the parts it needs.

**Postman v12 or later, desktop app only.** Local View and the v3 YAML format don't exist in older versions or the web app. On macOS check with `defaults read /Applications/Postman.app/Contents/Info.plist CFBundleShortVersionString`. Below 12, tell the operator to update, or route to Bruno or curl; never fall back to hand-writing v2.1 JSON for them to import. Install: macOS `brew install --cask postman`; Windows `winget install -e --id Postman.Postman`; everything else at [postman.com/downloads](https://www.postman.com/downloads/).

## Format — the v3 collection schema

The authority is Postman's `collection-schema-v3` agent skill in [postmanlabs/skills](https://github.com/postmanlabs/skills/tree/main/plugins/postman/skills/collection-schema-v3) (the repo carries no license, so it isn't vendored here). The fields below cover HTTP requests; for GraphQL, gRPC, WebSocket, Socket.IO, MQTT, MCP or LLM requests, read its [`reference/other_protocols.md`](https://raw.githubusercontent.com/postmanlabs/skills/main/plugins/postman/skills/collection-schema-v3/reference/other_protocols.md) first, and re-read the upstream skill whenever a field here seems missing.

**Request** (`<Name>.request.yaml`): `$kind: http-request` (required) · `method` · `url` · `order` · `headers`, `queryParams` (arrays of `{key, value, description?, disabled?}`) · `pathVariables` (`{key, value, description?}`) · `body: {type, content}` · `auth: {type, credentials: [{key, value}]}` · `scripts` (array of `{type: beforeRequest | afterResponse, language: text/javascript, code}`) · `settings` · `name` only when it differs from the filename · `description`, which the upstream field list leaves out but files Postman writes carry.

**Body types:** `json`, `text`, `xml`, `html`, `javascript` take a string `content`; `urlencoded` takes `[{key, value}]`; `formdata` takes `[{key, type: text | file, value or src}]`; plus `file` and `none`.

**Folder or collection metadata** (`.resources/definition.yaml`, optional): `$kind: collection` (required, folders too) · `name` · `description` · `variables` (`[{key, value}]`, string values) · `auth` · `order` · `scripts` with `http:beforeRequest` / `http:afterResponse` types that run around every request inside.

**Environment** (`postman/environments/<Name>.environment.yaml`): no `$kind`; `name` plus `values: [{key, value, enabled, type: default | secret, description?}]`; an empty one is `values: []`.

The rules that bite hardest:

- **`.yaml`, not `.yml`**, for everything you write.
- **Single-quote any value holding `{{…}}`**: `url: '{{baseUrl}}/things'`. Unquoted, the braces read as a YAML map and the file fails to parse. Quote numbers and booleans meant as strings too (`value: '123'`).
- **`order` is relative, spaced by 1000** (`1000`, `2000`, `3000`), a bare number, never quoted, so a later insert needs no renumbering.
- **Multi-line bodies and scripts use a `|-` block.**
- **Filenames** can't hold `/ \ : * ? " < > |` (use `-`, and put the real name in `name`), must be unique per folder ignoring case, and a request file never goes inside a `.resources/` folder.
- **Write headers, query params and path variables as arrays of `{key, value}`**, even where an existing file uses a map.

## Collection layout

The folder the operator opens in Postman is the **project root**. Postman scans its `postman/collections/` and `postman/environments/`, and on first open writes a hidden `.postman/resources.yaml` that binds the folder to a workspace. Every folder directly under `postman/collections/` is its own collection, so each app is a collection here, where in Bruno it is a folder.

```
<project-root>/                  # reports/api/postman/ (default)  OR  a repo (or monorepo service folder)
├── .postman/resources.yaml      # written by Postman on Open folder, never by you
└── postman/
    ├── collections/
    │   └── <app>/               # one collection per app (scratch, acme, …)
    │       ├── .resources/
    │       │   └── definition.yaml    # $kind: collection, name, description, variables
    │       ├── Create thing.request.yaml
    │       └── checkout/              # subfolder = folder in the sidebar
    │           ├── .resources/definition.yaml
    │           └── Sign in.request.yaml
    └── environments/
        └── Local.environment.yaml     # name + values: [{key, value, enabled, type}]
```

A request file:

```yaml
$kind: http-request
description: Creates a thing. Expect 201 with the new id.
method: POST
url: '{{baseUrl}}/api/things'
order: 1000
headers:
  - key: Content-Type
    value: application/json
  - key: Authorization
    value: 'Bearer {{vault:ACME_API_KEY}}'
body:
  type: json
  content: |-
    {
      "name": "example"
    }
scripts:
  - type: afterResponse
    language: text/javascript
    code: |-
      pm.test('201 with an id', function () {
          pm.response.to.have.status(201);
          pm.expect(pm.response.json().id).to.be.a('string');
      });
```

**In-repo:** if the repo (or the service folder in a monorepo) already has `postman/` and `.postman/resources.yaml`, add to them. A fresh one gets `postman/collections/` and `postman/environments/` at the root the team will open; Postman writes `.postman/` when they do. Don't run `postman init` for them: it also installs Postman's skills and an `AGENTS.md` into the repo and offers a cloud workspace.

## Postman-specific rules

- **Secrets are local vault references**: `{{vault:KEY}}` directly in the request, resolved from the operator's **Postman Local Vault** (AES-256, on their machine, never synced to the cloud). You write the reference; the operator adds the key under **Vault → Local Vault** in the footer (the first open generates a vault key for them to save). Local vault secrets don't survive a Postman sign-out or a move to another machine, so a request that suddenly fails auth usually means the vault needs refilling. Name vault keys `UPPER_SNAKE` like the `.env` keys elsewhere, so the same name works for `curl_run`. Never put a secret in an environment file, not even with `type: secret`: that file is tracked in git.
- **`curl_run` can't read the vault.** To verify a draft with it, the operator keeps a gitignored `.env` at the project root with the same key names, and you pass `envFile` pointing at it. Offer it; otherwise they test in Postman.
- **Base URLs are environment variables** (`baseUrl`, `acmeBaseUrl`) in `postman/environments/<Name>.environment.yaml`, one file per environment. The operator picks the active one in the app's environment selector.
- **Tests** are `pm.test` + `pm.expect` (Chai) in an `afterResponse` script; the app shows pass/fail on Send. A secret-bearing request's test asserts something only a real authenticated call returns (the caller's id, a field from a guarded route), never just "not 401", so a missing vault key can't pass green.
- **Docs** are the request's `description`: what it does and what a good response looks like.
- **Collection-wide scripts** (a shared header, a contract check on every response) go in the collection's `definition.yaml` as `http:beforeRequest` / `http:afterResponse`, not copied into each request.
- **Parse-check every file you write.** Postman's schema skill warns that invalid YAML breaks silently and confusingly. If the `postman` CLI is on PATH, `postman collection lint <project-root>/postman/collections` and `postman environment lint <project-root>/postman/environments` are the authoritative check: they validate files and send nothing, and the Bash call prompts. Without the CLI, `ruby -ryaml -e 'YAML.load_file(ARGV[0])' "<file>"` per file is the floor.
- **Nothing touches Postman Cloud.** Never run `postman workspace push`, `connect-git`, `login`, or `signup`: pushing publishes the collection to Postman's cloud, which is the operator's call and made outside this skill.

## Flows — multi-step chains (sign-in → onboarding → checkout → activation)

A flow is a **folder of ordered requests that carry values forward**, built on native Postman features: `order`, `afterResponse` scripts, `pm.variables`, and the **Collection Runner**. Kevin authors the folder; the operator runs it from the folder's **Run** in the app. (`curl_run` is single-request verification only, never a flow runner.)

- **One folder per flow** (`postman/collections/<app>/checkout/`), requests ordered 1000, 2000, 3000 in run order.
- **Carry values forward with `pm.variables.set`**: Postman scopes it to the current request or collection run, so a sign-in stores the token and later steps read `{{sessionToken}}` for that run only.

```yaml
# 1 Sign in.request.yaml
scripts:
  - type: afterResponse
    language: text/javascript
    code: |-
      pm.test('signed in', function () { pm.response.to.have.status(200); });
      pm.variables.set('sessionToken', pm.response.json().token);
      pm.variables.set('memberId', pm.response.json().member.id);
```

- **Never chain with `pm.environment.set` or `pm.collectionVariables.set`.** Postman doesn't document whether Local View writes those back into the tracked YAML, so treat them as persistent and keep tokens, ids, and anything secret out of them.
- **Run the whole flow in the Runner.** A request sent on its own starts without the run's variables, so tell the operator the Runner is the entry point for a flow and single sends are for debugging.
- **Guard preconditions** in an early test (`pm.expect(pm.variables.get('sessionToken')).to.be.a('string')`) so a mid-flow failure reads clearly instead of cascading 401s.

## First-time operator steps

Fresh project root: scaffold `postman/collections/<app>/.resources/definition.yaml` and `postman/environments/Local.environment.yaml`, then tell the operator, once:

1. In the Postman desktop app, open (or create) a workspace, click **Files → Open folder**, and pick the project root. Postman connects the folder and adds `.postman/`. If the path has a dot-folder segment, the macOS dialog hides it; Cmd+Shift+. reveals it.
2. Stay in **Local View** (bottom left), where the files are; Cloud View is the synced copy and isn't touched.
3. Add each `{{vault:KEY}}` the report lists to **Vault** before sending.

A workspace connects to one folder at a time, so the personal default gets its own workspace (e.g. "Agent Kevin").
