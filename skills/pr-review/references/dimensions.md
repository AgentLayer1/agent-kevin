# Review lanes

Each lane is one parallel agent in Step 4. The checklist is the agent's prompt body; hand it over verbatim with the PR context. Every lane returns findings in the shape defined in `SKILL.md` → Step 4 and nothing else. A lane that finds nothing returns `no findings` and one line on what it checked.

Common rules for every lane:

- Judge the **head commit** in the worktree, not the diff in isolation. Open the callers and callees of anything changed.
- `git blame` before calling unchanged code a bug. Mark `introduced: pre-existing` honestly; the verifier drops it unless the PR makes it worse or newly reachable.
- One finding per defect. A pattern repeated in six places is one finding listing six anchors.
- Do not report what the linter, formatter, or type checker reports; those ran in Step 3. Do not report style outside the repo's written conventions.
- The failure sentence is mandatory: inputs or state, then the wrong outcome. No failure sentence, no finding; turn it into a `question`.

---

## Lane 1 — Correctness

The code does what the PR says it does, for every input it will actually see.

- Null and undefined paths: optional chaining that silently skips a write, a `?? default` that masks a missing required field, a narrowed `select` that no longer loads a field a downstream read needs.
- Boundaries: off-by-one in pagination and batch windows, inclusive/exclusive date ranges, timezone assumptions in deadline math, floating point where the domain needs a decimal type.
- Error handling: a `catch` that swallows and continues, a `finally` that marks success after a swallowed failure, an error thrown at an API boundary in a shape the global handler turns into a generic 500.
- Async: an un-awaited promise, `Promise.all` over a list where one rejection should not cancel the rest, a retry that reuses the failed connection or client.
- Concurrency and idempotency: a read-then-write with no claim or lease, a claim that is never released, an idempotency key generated per attempt instead of per intent, two processes that can both act on the same row.
- Control flow: a guard that can never fire under the condition it names, a `switch` missing a case the enum now has, a feature flag defaulting to the enforced side.
- Data shape: a JSON blob where a column was needed, a field written but never read, a field read but never written on any path.

## Lane 2 — Domain invariants, state machines, and authorization

Anything that moves value, changes what a user can do, or decides an outcome the business depends on. The invariants come from `knowledge/concepts/` and the repo's own docs; cite the article you apply.

- State transitions: does the change auto-advance or auto-recover a state the design deliberately leaves for manual investigation? A "fix" that unsticks something the concept article says must stay stuck is a finding, not a fix.
- Double effects: any external call without an idempotency key or a marker written before the call; a side effect that runs twice on retry.
- Ledger-style invariants: every movement has its counterpart record; amounts reconcile across legs; fees or counters are not double-applied; enums cover the new path.
- Gates: a path that reaches an external service before a required check clears, a new evaluator skipped or defaulted to pass, an exemption list widened, provenance dropped.
- Derived status: a status derivation changed, a write removed from one service while another still reads it, environment gating that keys on anything other than the canonical production flag.
- Authorization: a route without a permission or role guard, a public-route decorator on something that self-authenticates, a permission resolver that widens (`in` on an object walks the prototype), a tenant or team scope check that moved or disappeared. For auth and value paths the diff must let a reviewer see **by inspection** that the safety checks did not move; if the change needed them to move, the change is wrong-shaped.
- Thresholds and reporting: limits, deadline math, and report triggers changed without a test pinning the boundary.

## Lane 3 — Security and privacy

- Secrets and PII in logs: interpolated API keys, tokens, signatures, emails, names, document contents into a log string or an exception message. Static message plus structured context is the convention; use the repo's redaction helper if it has one.
- Internal names in user-visible strings: `message`, `details`, response bodies, webhook payloads, public docs. Partner and vendor names belong in logs and error causes only.
- Input validation: DTO fields without validation decorators, `any`-typed request bodies, string IDs passed straight into a query, enum fields typed as `string`.
- Injection: raw SQL with interpolation, shell commands built from input, HTML rendered from a third-party payload without sanitizing.
- Webhook trust: an inbound webhook handled without signature verification, a signature check that runs after the side effect, replay without an event-id dedupe.
- Authn edges: cache staleness for revoked keys or removed allowlist IPs, a session read that trusts a client-supplied tenant id, CORS or cookie domain changes.
- Dependencies: a new package added for one call, a lockfile change unrelated to the PR, a postinstall or allow-build change.
- Data exposure: a new field on a public response that carries internal state, an admin endpoint reachable through the customer API, a storage key or URL that is guessable.

## Lane 4 — Regressions and blast radius

What this PR breaks in code it did not touch.

- Callers: `Grep` the worktree for every changed exported symbol and every changed signature. A default parameter added, an argument reordered, a return shape narrowed: check each call site.
- Deleted or moved writes: for every removed assignment or `data:` field, find the `select`/`include`/reader that still expects it. A UI element that silently renders nothing is the classic symptom.
- Schema: new required column with no default, enum value added without every `switch` and validation schema learning it, an index removed, mapped column names, migration order versus code order (schema must deploy before the code that reads it).
- API contract: response fields removed or renamed, status codes changed, error codes changed, the OpenAPI default now wrong, webhook payload shape changed with no version.
- Shared packages: a change in a shared types or utils package that another app imports; a layer that must stay browser-safe pulling in a server-only dependency.
- Process placement: logic moved between processes (api, worker, frontend), and the config keys, env vars, and DI providers it needs exist in the new process.
- Config and environment: a new env var read with a throwing getter and no entry in `.env.example` or the deploy config, a default that differs between environments, a flag that flips behavior on merge instead of by env.
- Jobs and loops: a new unbounded query in an interval loop, a batch with no cap, a poll whose interval changed, a claim predicate that now matches rows it should not.
- Deploy-time behavior: a boot-time audit that throws, a migration that locks a hot table, a startup dependency on a service that may be down.

## Lane 5 — Conventions and quality

Only what the repo's written conventions say (`AGENTS.md`, `CLAUDE.md`, or `CONTRIBUTING.md` at the root and any directory-level file). Cite the rule you apply.

- Errors: the repo's error type only at API boundaries, a real error code, thrown close to the check, not in controllers or pipes.
- Logging: the repo's logger idiom; static message plus structured fields; no interpolated identifiers.
- Comments: default none; a comment every few lines is a code-quality finding, not documentation; JSDoc only on consumer-facing exports, multi-line form; no tombstones, no ownerless TODO.
- Types: no `any`, no `!`, no unjustified `as`; `interface` for object contracts; const objects over enums; discriminated unions for state; single-use types inline.
- Helpers: before accepting a new small helper, `Grep` the repo's shared helpers for an existing one. Duplicates are a finding with the existing path.
- Cross-cutting concerns: a fix living at one call site of something a decorator, interceptor, or middleware already handles one level lower.
- Functional style: `map`/`filter`/`reduce` over loops with `continue`; no single-letter params except a numeric `i`; immutability.
- Structure: the repo's folder convention, its file-size cap, no barrel re-exports.
- Diff hygiene within files: unrelated reformatting (semicolon churn, import reordering) that belongs in its own commit or an earlier layer of the stack.

## Lane 6 — Tests

- Every finding-class path in lanes 1–2 has a spec that would fail if the fix were reverted. Name the missing test by the behavior it pins.
- Tests that assert nothing (`expect(result).toBeDefined()`), tests that mock the unit under test, snapshot tests over numeric outputs, tests that pass on the base branch and on the PR branch identically.
- Deleted or weakened tests: a removed assertion, a `.skip`, a loosened matcher, an invariant that used to be pinned and now is not.
- Test placement: specs where the repo keeps them; end-to-end scenarios in the repo's harness, not ad hoc scripts.
- Round-trip-for-coverage tests are a finding too: they cost attention and protect nothing.

## Lane 7 — PR hygiene

The PR as an artifact a reviewer can trust.

- **Body versus diff.** Does the description describe this diff? Deleted files, removed guards, or behavior changes the body calls "none" are blockers: a reviewer approving the body approves a different change.
- Scope: hunks that do not trace to the stated purpose. A root-cause fix carries only itself; unrelated improvements are a defect even when builds pass. Exception: a reviewer-requested fix inside files the PR already touches.
- Size and shape: a PR that should be a stack, a stack layer that is not "a discrete, reviewable change", a layer based on the wrong parent.
- Commit shape: one commit per phase, no fixup noise that should have been squashed before publishing, no merge of the base branch that hides a rebase gone wrong (phantom diffs).
- Deploy safety: the merge itself changes prod posture (a default flips on merge), a schema change ships in the same deploy as the code that needs it already applied, a manual step the body does not mention.
- Rollback: can this be reverted with one `git revert`? Data written in a new shape that the old code cannot read is a one-way door; say so.
- Claims: "tested on staging", "no behavior change", "verified in prod" without a record ID, a log line, or a spec. Ask for the receipt.
- Linked work: the task or issue the PR closes actually closes; acceptance criteria met or explicitly deferred.
