# Simplify

**You own the verdict on the target.** Double-check and review the target the operator named (script, app, area, or change). Make sure it is elegant, simple, concise, accurate, robust, reliable, and good — not over-engineered or over-complicated. Make sure things are using best practices.

## Procedure

1. **Identify the target.** If the operator named a specific script/app/area/change, scope to that. If unclear, ask one clarifying question — don't guess broadly.
2. **Read the relevant code end-to-end.** Don't skim. Understand control flow, data flow, dependencies, and the contract with callers before suggesting anything.
3. **Audit against the criteria below**, with the principles lenses beside them. For each finding, note: what's wrong, why it matters, and the simpler/better alternative.
4. **Hunt dead code.** Find and flag for removal: unused imports, unreferenced functions/variables/types, unreachable branches, commented-out code, orphaned files, parameters never read, exports with no consumers, and feature flags whose migration is complete. Verify with grep/refs before recommending deletion — don't trust appearances.
5. **Present the findings** (Output below) and ask which to apply.
6. **Apply what the operator picked** with the [refactoring](refactoring.md) playbook's safety steps: pin the behavior first, land removals before reshapes, prove behavior is unchanged on the real artifact.
7. **Run the host's built-in simplify pass over the resulting diff** where the host ships one (Claude Code's `/simplify`, through the Skill tool); skip it where there is none. It hunts reuse, efficiency, and altitude cleanups in changed code and applies them directly, so it runs only after the operator's go, and its edits get the same scrutiny as yours: each one traces to a criterion below or it's reverted.
8. Run the [comment pass](../comment-pass.md) before the diff is shown.

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

**Principles lenses.** The criteria say what's wrong; these say how far to go:

- [Laziness protocol](../principles/laziness-protocol.md) and [subtract before you add](../principles/subtract-before-you-add.md): the smallest change that reaches the simpler shape, and deletion first.
- [Minimize reader load](../principles/minimize-reader-load.md): a finding earns its place when it cuts the layers or state a reader holds.
- [Redesign from first principles](../principles/redesign-from-first-principles.md): band-aids piled on band-aids get a rewrite around today's requirements, not another patch.
- [Type system discipline](../principles/type-system-discipline.md) and [boundary discipline](../principles/boundary-discipline.md): illegal states made unrepresentable, validation at the edge only.

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

After listing findings, ask the operator if they want you to apply the changes, or pick a subset.

## What to Avoid

- Don't rewrite working code just because you'd have written it differently.
- Don't add tests, docs, or refactors that weren't part of the request.
- Don't "improve" adjacent code outside the target area.
- Don't recommend abstractions for a single use case.
- Don't suggest defensive programming for impossible inputs.

The bar: every recommended change must trace directly to one of the criteria above, with a concrete reason.
