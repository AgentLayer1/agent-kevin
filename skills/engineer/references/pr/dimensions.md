# Review lanes

Each lane is one parallel agent in the [pr review](../playbooks/pr-review.md) fan-out (step 2), or one of the three lanes a grouped agent carries on a compact run. The checklist is the agent's prompt body; hand it over verbatim with the PR context, plus the absolute paths of the files its **Reads** line names. Each heading ends with the lane's slug, which the `lane:` field uses. A grouped agent works each lane's checklist in turn and sets `lane:` on every finding to the lane that found it. Every lane returns findings in the shape defined in that step and nothing else. A lane that finds nothing returns `no findings` and one line on what it checked.

Common rules for every lane:

- Judge the **head commit** in the worktree, not the diff in isolation. Open the callers and callees of anything changed.
- `git blame` before calling unchanged code a bug. Mark `introduced: pre-existing` honestly.
- One finding per defect. A pattern repeated in six places is one finding listing six anchors.
- Do not report what the linter, formatter, or type checker reports when it ran clean in the local gates ([foundation](foundation.md) → Step 3); when a gate did not run, its class of defect is in scope. Do not report style outside the repo's written conventions.
- The failure sentence is mandatory: inputs or state, then the wrong outcome. No failure sentence, no finding; turn it into a `question`.
- Every file on the coverage checklist gets its own pass and its own `coverage:` line. Reading an implementation does not cover its interface, schema, migration, or config counterpart, and a small file is not a reason to skip it.
- `code:` carries the anchored lines verbatim from the head commit. The verifier re-finds a finding by that snippet when the line number drifts; a paraphrased snippet cannot be found.
- Read the files a lane's **Reads** line names before judging, and cite the one a finding applies in its `principle:` field. They are the bar the lane holds the change to, not background.
- When a language addendum from `langs/` is attached, it extends this checklist for files of that language; it does not replace it.

---

## Lane 1 — Correctness · `correctness`

The code does what the PR says it does, for every input it will actually see.

**Reads:** [make operations idempotent](../principles/make-operations-idempotent.md) · [separate before serializing shared state](../principles/separate-before-serializing-shared-state.md) · [boundary discipline](../principles/boundary-discipline.md) · [fix root causes](../principles/fix-root-causes.md)

- Missing values: an optional access that silently skips a write, a default that masks a missing required field, a narrowed query projection that no longer loads a field a downstream read needs.
- Boundaries: off-by-one in pagination and batch windows, inclusive/exclusive date ranges, timezone assumptions in deadline math, floating point where the domain needs a decimal type.
- Error handling: a `catch` that swallows and continues, a `finally` that marks success after a swallowed failure, an error thrown at an API boundary in a shape the global handler turns into a generic 500.
- Async: an async call nobody awaits, a fan-out where one failure cancels work that should continue, a retry that reuses the failed connection or client.
- Concurrency and idempotency: a read-then-write with no claim or lease, a claim that is never released, an idempotency key generated per attempt instead of per intent, two processes that can both act on the same row.
- Partial runs: an operation that leaves different state when rerun after a crash halfway, a done-marker (version, cursor, status) written before the work it marks, two actors writing one shared file or key where each could own its own.
- Control flow: a guard that can never fire under the condition it names, a `switch` missing a case the enum now has, a feature flag defaulting to the enforced side.
- Data shape: a JSON blob where a column was needed, a field written but never read, a field read but never written on any path.

## Lane 2 — Domain invariants, state machines, and authorization · `invariants`

Anything that moves value, changes what a user can do, or decides an outcome the business depends on. The invariants come from `knowledge/concepts/` and the repo's own docs; cite the article you apply.

**Reads:** [model the domain](../principles/model-the-domain.md) · [type system discipline](../principles/type-system-discipline.md)

- State transitions: does the change auto-advance or auto-recover a state the design deliberately leaves for manual investigation? A "fix" that unsticks something the concept article says must stay stuck is a finding, not a fix.
- Double effects: any external call without an idempotency key or a marker written before the call; a side effect that runs twice on retry.
- Ledger-style invariants: every movement has its counterpart record; amounts reconcile across legs; fees or counters are not double-applied; enums cover the new path.
- Gates: a path that reaches an external service before a required check clears, a new evaluator skipped or defaulted to pass, an exemption list widened, provenance dropped.
- Fallbacks: a fallback path that can retry or reroute an instruction the first path may already have carried out.
- Derived status: a status derivation changed, a write removed from one service while another still reads it, environment gating that keys on anything other than the canonical production flag.
- Authorization: a route without a permission or role guard, a public-route marker on something that self-authenticates, a permission resolver that widens (a membership check that also matches inherited or default keys), a tenant or team scope check that moved or disappeared. For auth and value paths the diff must let a reviewer see **by inspection** that the safety checks did not move; if the change needed them to move, the change is wrong-shaped.
- Thresholds and reporting: limits, deadline math, and report triggers changed without a test pinning the boundary.

## Lane 3 — Security and privacy · `security`

**Reads:** [boundary discipline](../principles/boundary-discipline.md)

- Secrets and PII in logs: interpolated API keys, tokens, signatures, emails, names, document contents into a log string or an exception message. Static message plus structured context is the convention; use the repo's redaction helper if it has one.
- Internal names in user-visible strings: `message`, `details`, response bodies, webhook payloads, public docs. Partner and vendor names belong in logs and error causes only; scrub pre-existing leaks in the code the PR touches. Absolute machine paths leak the host's layout; user-facing output shows repo-relative paths.
- Input validation: request fields with no validation, an untyped request body, string IDs passed straight into a query, a closed set of values typed as a free string.
- Injection: raw SQL with interpolation, shell commands built from input, HTML rendered from a third-party payload without sanitizing.
- Webhook trust: an inbound webhook handled without signature verification, a signature check that runs after the side effect, replay without an event-id dedupe.
- Authn edges: cache staleness for revoked keys or removed allowlist IPs, a session read that trusts a client-supplied tenant id, CORS or cookie domain changes.
- Dependencies: a new package added for one call, a lockfile change unrelated to the PR, an install-script or build-permission change.
- Data exposure: a new field on a public response that carries internal state, an admin endpoint reachable through the customer API, a storage key or URL that is guessable.

## Lane 4 — Regressions and blast radius · `regressions`

What this PR breaks in code it did not touch.

**Reads:** [blast radius](../playbooks/blast-radius.md) · [prove it works](../principles/prove-it-works.md) · [migrate callers, then delete legacy APIs](../principles/migrate-callers-then-delete-legacy-apis.md)

- The safety fact first: most risky-looking changes are safe because of one fact ("this only drops entries that are already dead"). Name it, then check it as far as is cheap: point at the line, walk the failure, or run a script against the real code. Report which level it reached; an unproven safety fact is a question, not a pass.
- Callers: `Grep` the worktree for every changed exported symbol and every changed signature. A default parameter added, an argument reordered, a return shape narrowed: check each call site.
- Deleted or moved writes: for every removed assignment or written field, find the query projection or reader that still expects it. A UI element that silently renders nothing is the classic symptom.
- Schema: new required column with no default, enum value added without every `switch` and validation schema learning it, an index removed, mapped column names, migration order versus code order (schema must deploy before the code that reads it).
- API contract: response fields removed or renamed, status codes changed, error codes changed, the OpenAPI default now wrong, webhook payload shape changed with no version.
- Shared packages: a change in a shared types or utils package that another app imports; a layer that must stay browser-safe pulling in a server-only dependency.
- Process placement: logic moved between processes (api, worker, frontend), and the config keys, env vars, and DI providers it needs exist in the new process.
- Config and environment: a new env var read with a throwing getter and no entry in `.env.example` or the deploy config, a default that differs between environments, a flag that flips behavior on merge instead of by env.
- Jobs and loops: a poll whose interval changed, a claim predicate that now matches rows it should not. Their cost (unbounded queries, uncapped batches) is the `performance` lane.
- Deploy-time behavior: a boot-time audit that throws, a migration that locks a hot table, a startup dependency on a service that may be down.

## Lane 5 — Conventions and quality · `conventions`

Only the conventions the foundation's Step 1 found (the repo's written docs at the root and any directory level, then, where they are silent, the pattern its code already follows) and the engineering principles. Cite the rule, the two neighboring examples, or the principle you apply.

**Reads:** [laziness protocol](../principles/laziness-protocol.md) · [subtract before you add](../principles/subtract-before-you-add.md) · [minimize reader load](../principles/minimize-reader-load.md) · [model the domain](../principles/model-the-domain.md) · [type system discipline](../principles/type-system-discipline.md) · [migrate callers, then delete legacy APIs](../principles/migrate-callers-then-delete-legacy-apis.md) · [encode lessons in structure](../principles/encode-lessons-in-structure.md) · [architect](../architect.md) (the design red flags) · [comment pass](../comment-pass.md) (what a comment may say)

- Errors: the repo's error type only at API boundaries, a real error code, thrown close to the check, not in the transport layer.
- Logging: the repo's logger idiom; static message plus structured fields; no interpolated identifiers.
- Comments: default none; a comment every few lines is a code-quality finding, not documentation; doc comments only on consumer-facing exports; no tombstones, no ownerless TODO.
- Types: the repo's type rules; no escape hatch that silences the checker without a stated reason; a tagged union for state instead of flags that must agree; single-use types inline.
- Cross-cutting concerns: a fix living at one call site of something a decorator, interceptor, or middleware already handles one level lower.
- Structure: the repo's folder convention and its file-size cap.
- Diff hygiene within files: unrelated reformatting (semicolon churn, import reordering) that belongs in its own commit or an earlier layer of the stack.
- Structure the style guide doesn't name. Prefer a few high-conviction structural findings over a list of cosmetic ones:
  - A missed simplification: the change keeps incidental complexity that a reframing would delete (whole branches, modes, or helpers), not just rearrange.
  - Spaghetti growth: a new ad hoc conditional or feature check threaded into an unrelated shared flow; a second boolean that must stay in sync with a first.
  - Design red flags: a shallow module (callers coordinate several methods for one operation), information leakage (wire or storage types on a public surface), temporal decomposition (load, validate, save modules repeating one representation), a pass-through method.
  - A legacy dual path: a new internal API added while the old one stays alive with no external consumer.
  - An instruction where structure belongs: a comment or convention saying "don't do X" where a type, test, or lint could make X impossible.
  - File growth: a file pushed from under 1,000 lines to over it without a structural reason.

## Lane 6 — Tests · `tests`

**Reads:** [test behavior, not implementation](../principles/test-behavior-not-implementation.md) · [sequence verifiable units](../principles/sequence-verifiable-units.md)

- Every finding-class path in lanes 1–2 has a spec that would fail if the fix were reverted, where the repo's test policy calls for one (read it in the repo's agent docs or `CONTRIBUTING.md`; with neither, infer it from where tests already live and say so; a repo that tests only shared utilities makes a missing app-code spec a non-finding). Name the missing test by the behavior it pins.
- Hollow tests, the ones that would still pass if every imported function returned nothing: no assertion or one that only checks existence, truthiness, or no-throw; only mock-call or empty-result checks; an expected value computed by the code under test; a restated constant or prompt string; a fixture asserting itself while the subject never runs. Also: tests that mock the unit under test (a spy that wraps the real function is fine), snapshot tests over numeric outputs, tests that pass on the base branch and on the PR branch identically.
- What breaks this test? For each new or changed test, name one plausible production change that would make it fail. If the only answer is a rename, it is hollow.
- Tests of the platform, not the project: a test that proves the language, the framework, or a plain data holder works, with no project logic in the path.
- Test doubles not shaped from the real interface: a hand-written fake or stub that would keep passing after the real API changes shape.
- Production logic changed with no test changed or added, where the repo's test policy asks for one.
- Deleted or weakened tests: a removed assertion, a skipped test, a loosened matcher, an invariant that used to be pinned and now is not.
- Test placement: specs where the repo keeps them; end-to-end scenarios in the repo's harness, not ad hoc scripts.
- Round-trip-for-coverage tests are a finding too: they cost attention and protect nothing.

## Lane 7 — PR hygiene · `hygiene`

The PR as an artifact a reviewer can trust.

**Reads:** [handoff](../handoff.md) (what a PR description and commit shape owe a reviewer) · [sequence verifiable units](../principles/sequence-verifiable-units.md)

- **Body versus diff.** Does the description describe this diff? Check every claim the body makes at the head and return one row each for the report's description check: `matches`, `partly`, `wrong`, or `missing` (a change the body leaves out: a DTO sweep, a schema change, a deploy step). Descriptions go stale as the code moves under review, and the merged description is the record people and agents read later, so a stale one is worth a finding even when the code is right. Deleted files, removed guards, or behavior changes the body calls "none" are blockers: a reviewer approving the body approves a different change.
- Scope: hunks that do not trace to the stated purpose. A root-cause fix carries only itself; unrelated improvements are a defect even when builds pass. Exception: a reviewer-requested fix inside files the PR already touches.
- Reach beyond intent: a CI workflow, build config, shared config, or dependency change whose effect is wider than the PR's stated purpose (a lint rule turned off repo-wide to land one file, a version bump riding along with a bug fix).
- Size and shape: a PR that should be a stack, a stack layer that is not "a discrete, reviewable change", a layer based on the wrong parent.
- Commit shape: one commit per phase, no fixup noise that should have been squashed before publishing, no merge of the base branch that hides a rebase gone wrong (phantom diffs).
- Deploy safety: the merge itself changes prod posture (a default flips on merge), a schema change ships in the same deploy as the code that needs it already applied, a manual step the body does not mention.
- Rollback: can this be reverted with one `git revert`? Data written in a new shape that the old code cannot read is a one-way door; say so.
- Claims: "tested on staging", "no behavior change", "verified in prod" without a record ID, a log line, or a spec. Ask for the receipt.
- Linked work: the task or issue the PR closes actually closes; acceptance criteria met or explicitly deferred.

## Lane 8 — Generated-code tells · `generated-code`

The ways code written fast, often by a model, goes wrong while still compiling and passing its own tests. Check every item against the code installed in the worktree, never against memory of an API.

**Reads:** [laziness protocol](../principles/laziness-protocol.md) · [fix root causes](../principles/fix-root-causes.md) · [test behavior, not implementation](../principles/test-behavior-not-implementation.md) · [migrate callers, then delete legacy APIs](../principles/migrate-callers-then-delete-legacy-apis.md)

- Invented surface: a call to a function, method, option, config key, environment variable, or CLI flag that does not exist at the installed version. Open the dependency's source or type definitions in the worktree, at the version the lockfile pins. An option the library silently ignores counts too: the setting looks applied and changes nothing.
- Reinvention: a new helper, type, constant, or wrapper that duplicates one the repo already has. `Grep` the shared packages and neighboring modules; the finding names the existing path.
- Partial migration: a pattern changed at some call sites and not others. Count both: "changed 4 of 6 callers; `<path>` and `<path>` still use the old shape".
- Tests bent to pass: an expected value, snapshot, or assertion edited in the same change as the code it checks, with no behavior change stated in the body. Either the behavior changed and the body must say so, or the test was edited to match a bug.
- Suppressions to get green: a new type-checker ignore, lint disable, skipped test, `continue-on-error`, widened type, lowered coverage or quality threshold, or catch-all handler. Each one needs a reason in the code or the body.
- Scaffolding in production: test fixtures, mock data, debug flags, a branch on the test environment, a hard-coded ID, or a placeholder body (`return []`, "not implemented") on a path production reaches.
- Speculative generality: an option, parameter, flag, interface, or layer with one caller and no second one in sight; configuration for a value that never varies.
- Defensive noise: a guard, fallback, retry, or `try` around code that cannot fail the way it guards against, or that turns a broken contract into a silent default. Trace whether the failure can happen before accepting the guard.
- Unexplained constants: a timeout, limit, threshold, retry count, or pattern with no source, no test pinning it, and no reason in the body.
- Leftovers: commented-out code, debug logging, a TODO or FIXME with no owner or issue, an unused export, parameter, or import the change created.

## Lane 9 — Performance and resources · `performance`

What the change costs at the sizes it will actually see. Every finding states a realistic size ("teams with 2,000 members", "the 40k-row orders table") or names the hot path it runs on; without one it is a question, not a finding.

**Reads:** [prove it works](../principles/prove-it-works.md) · [boundary discipline](../principles/boundary-discipline.md)

- Round trips: a query or remote call inside a loop over a collection (N+1), a per-item fetch where one batched read exists.
- Unbounded work: a query or listing with no limit or pagination on a user-controlled size, a batch with no cap, a new unbounded query inside a job or interval loop, a fan-out with no concurrency limit.
- Complexity: nested passes over input-sized collections, a linear search inside a loop where a map lookup fits, sorting or copying a large collection per item.
- Indexes: a new filter, join, or sort on a column the schema does not index, on a table that grows.
- Blocking: synchronous file, network, or CPU-heavy work on a request path, the UI thread, or an event loop.
- Timeouts: an external call with no timeout, deadline, or cancellation, so one slow dependency holds a worker or a request forever.
- Growth: a cache, map, or queue with no bound or eviction; a listener, subscription, or timer with no cleanup; a whole file or response read into memory where a stream was needed.
- Repeated work: an expensive computation redone on every render, request, or loop tick when its inputs did not change.

## Lane 10 — Architecture · `architecture`

Runs only on a large feature: a new provider, integration or module, or about 1,500+ production lines across more than one app. The question is not whether each line is right but whether the feature lives in the right place: code spread across shared flows makes every later change touch it, and every next feature of its kind copies it.

**Reads:** [model the domain](../principles/model-the-domain.md) · [boundary discipline](../principles/boundary-discipline.md) · [migrate callers, then delete legacy APIs](../principles/migrate-callers-then-delete-legacy-apis.md) · [subtract before you add](../principles/subtract-before-you-add.md) · [sequence verifiable units](../principles/sequence-verifiable-units.md)

- Map the feature by lifecycle stage (for a provider integration: account setup and requirements, request creation and routing, execution, settlement and returns, webhooks, ops) and name every file each stage touches.
- Measure the footprint: files outside the feature's own folder, feature or provider literals branching shared code (`=== Provider.X`, `case X`), lines added to files already over the repo's size cap, steps copied from a sibling feature and how far the copies have drifted. Count with grep and `git diff --stat`, never by eye.
- Find the extension points the repo already has for this kind of feature (a provider interface and registry, a guard base class, a shared pipeline step, a module registration token) and check whether the PR uses them. A parallel mechanism beside an existing one is the finding, named with the existing symbol and path.
- Start from the target the team already chose: the concept articles and the operator's pinned architecture docs name it (a step engine, a registry, a route model), even when it sits on an unmerged branch. Read that interface on its branch and recommend toward it rather than inventing a second shape; say plainly when it isn't merged yet.
- Recommend the shape that keeps the feature in its own folder behind the existing interfaces, and the smallest platform change that makes that possible (a hook the interface lacks, a shared step to extract). Prefer paying down the debt the feature would deepen: the copy that becomes one shared step, the sibling feature that gets the same fix for free.
- Map the feature onto that interface hook by hook (`mapping`): which function becomes which hook, and which findings disappear because the shared code owns the rule. A target that looks as busy as today is a drawing problem until proven otherwise: redraw it in today's columns with one node per role.
- Compare the feature folder's file layout today against an organized target (`comparisons`): group by concern in subfolders, tests beside what they test, generated data in one place. Then sketch the code skeleton for today and target, the target copied from a sibling provider already on the chosen interface, so the recommendation reads as code an engineer would write, not boxes.
- Lay out the path as ordered, separately reviewable PRs, lined up with any split already agreed, the platform change first.
- When the recommendation reverses a call the operator or team already made (a recorded decision, a PR-thread agreement), say so with its cost and benefit instead of overriding it quietly.
- Return the report's `architecture` data (per [PR report](report.md) → Review), and findings only for concrete defects the shape causes now (a copy that has already drifted into a bug), in the normal finding shape with `lane: architecture`. A preference about structure with no failure scenario is not a finding: it's the recommendation.
