---
name: simple-simplify
description: Review the target (script/app/area/change) and simplify it. Ensure it is elegant, simple, concise, accurate, robust, reliable, and follows best practices — not over-engineered or over-complicated. Remove dead code. Only runs when explicitly invoked via /simple-simplify.
disable-model-invocation: true
---

# Simple Simplify

Double-check and review the target the user named (script, app, area, or change). Make sure it is elegant, simple, concise, accurate, robust, reliable, and good — not over-engineered or over-complicated. Make sure things are using best practices.

## Procedure

1. **Identify the target.** If the user named a specific script/app/area/change, scope to that. If unclear, ask one clarifying question — don't guess broadly.

2. **Read the relevant code end-to-end.** Don't skim. Understand control flow, data flow, dependencies, and the contract with callers before suggesting anything.

3. **Audit against the criteria below.** For each finding, note: what's wrong, why it matters, and the simpler/better alternative.

4. **Hunt dead code.** Find and flag for removal: unused imports, unreferenced functions/variables/types, unreachable branches, commented-out code, orphaned files, parameters never read, exports with no consumers, and feature flags whose migration is complete. Verify with grep/refs before recommending deletion — don't trust appearances.

## Audit Criteria

Check the code along these dimensions:

- **Elegance** — Does the shape of the code match the shape of the problem? Are abstractions earning their keep, or is one-shot logic hiding behind a class/factory/wrapper?
- **Simplicity** — Could this be fewer lines, fewer files, fewer concepts without losing correctness? Three similar lines beat a premature abstraction.
- **Conciseness** — Any dead code, unused imports, redundant branches, repeated logic, or commentary that just narrates what the code already says?
- **Accuracy** — Does it actually do what it claims? Edge cases handled? Off-by-ones, type coercion, async ordering, error paths?
- **Robustness** — Behaves under bad input, partial failure, retries, race conditions? Validates at boundaries (user input, external APIs) but trusts internal callers?
- **Reliability** — Deterministic where it should be? No flaky timing assumptions, hidden state, or implicit globals?
- **Best practices** — Idiomatic for the language/framework? Follows project conventions (tsconfig, eslint, existing patterns)? Uses standard tools instead of bespoke reinvention?
- **Not over-engineered** — No speculative flexibility, no config knobs no one uses, no backwards-compat shims for code that has no consumers, no "what if we need X someday" features.

## Common Smells to Flag

- Wrappers, factories, or classes around a single function call.
- Error handling for scenarios that can't happen given the call sites.
- Feature flags or branching for migrations that are already complete.
- `any` casts, `!` non-null assertions, or `as` casts without justification.
- Try/catch blocks that swallow errors silently or rethrow unchanged.
- Comments explaining *what* the code does (the code already says that).
- Configuration objects with one caller.
- Re-exports, barrel files, or indirection that adds zero value.
- Helpers used in one place — usually inline beats extract.
- Mutating data structures when a pure transform would do.

## Output

Present findings as a prioritized list:

1. **Critical** — bugs, correctness issues, security risks. Fix.
2. **Worth simplifying** — over-engineering, dead weight, redundant abstractions. Recommend removal/inlining with the concrete diff.
3. **Style/nits** — minor consistency issues. Group together, don't belabor.

For each item, show: the location (`file:line`), the problem in one sentence, and the suggested change. Keep the writeup tight — one paragraph per finding max.

After listing findings, ask the user if they want you to apply the changes, or pick a subset.

## What to Avoid

- Don't rewrite working code just because you'd have written it differently.
- Don't add tests, docs, or refactors that weren't part of the request.
- Don't "improve" adjacent code outside the target area.
- Don't recommend abstractions for a single use case.
- Don't suggest defensive programming for impossible inputs.

The bar: every recommended change must trace directly to one of the criteria above, with a concrete reason.
