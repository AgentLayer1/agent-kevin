# Refactoring and simplification

**You own the contract.** The structure changes and the behavior doesn't. A redesign that changes behavior is a [feature](feature.md), so name it and switch playbooks. A real bug found along the way gets split out and fixed on its own.

1. **Pin the behavior first.** Learn the contract, then capture it before moving anything: a characterization test, a snapshot, or a script that diffs old against new output. A type check and a lint pass are not a pin.
2. **Read the target end to end** (control flow, data flow, callers) and audit it:
   - **Dead weight:** unused imports, unreferenced functions, unreachable branches, parameters never read, exports with no consumers, flags for finished migrations, commented-out code. Confirm each with a grep before deleting.
   - **Layers:** one-caller wrappers, pass-through methods, adapters with one implementation, configuration objects with one caller, barrel re-exports ([minimize reader load](../principles/minimize-reader-load.md)).
   - **Structure:** scattered booleans, growing if/else chains, and repeated shape assumptions that want a state machine, a table, or a typed model ([model the domain](../principles/model-the-domain.md)).
   - **Types and boundaries:** `any`, `!`, `as`, optional-field bags, and validation deep inside instead of at the edge ([type system discipline](../principles/type-system-discipline.md), [boundary discipline](../principles/boundary-discipline.md)).
   - **Noise:** error handling for impossible cases, a try/catch that swallows or rethrows unchanged, mutation where a pure transform would do, comments that narrate.
   - **The code-judo move:** a reframing that makes whole branches, modes, or helpers disappear, not just a local tidy-up.
3. **Name the target shape:** the module layout, types, and call graph you'd build today. If it crosses a function boundary, sketch it ([architect](../architect.md)).
4. **Subtract before you add.** Removals land first, in their own commit ([subtract before you add](../principles/subtract-before-you-add.md)). The smallest change that reaches the target ships ([laziness protocol](../principles/laziness-protocol.md)).
5. **Move in small behavior-preserving steps,** each keeping the pin green. For an API reshape, migrate every caller and delete the old path in the same wave ([migrate callers, then delete legacy APIs](../principles/migrate-callers-then-delete-legacy-apis.md)). Check every rename in strings, docs, and back-references, because symbol search misses them.
6. **Prove behavior is unchanged** on the real artifact. Rerun the pin, and for a larger reshape, run the equivalence check.
7. **Keep it only if reader load dropped.** If the diff doesn't make some question faster to answer, revert it.
8. Commit the subtraction, then the reshape, then any follow-on cleanup. Run the [comment pass](../comment-pass.md), then follow [handoff](../handoff.md).

**Simplify and review-only requests** ("simplify this", "is this over-engineered?", "review this for cleanup") go through the [simplify](simplify.md) playbook, which audits first and comes back here to apply.

**Reply:** the structure that changed, the pin, the equivalence proof, the reader-load delta, and what shipped versus what got reverted.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) refactoring playbook (MIT, Copyright (c) 2026 Lauren Tan).
