# Migrate, then delete

**Apply when:** introducing a new internal API while old callers exist, or running a planned rewrite or migration with phase boundaries.

- **One wave.** Inventory the callers, migrate them, and delete the old API in the same wave. Don't keep a compatibility path only because internal callers still exist.
- **Adapters are exceptions.** A temporary adapter is time-boxed and named as temporary, never default architecture.
- **Parameterize without breaking.** A new parameter defaults to the old hardcoded value, so existing callers keep their behavior without edits.
- **Tests follow the contract.** Update tests to assert the new contract, and delete tests that only protect pre-refactor internals.
- **Converge on the end state.** Don't preserve smooth intermediate states with throwaway compatibility code. Planned, scoped, reversible breakage mid-migration is fine. Declare where it is allowed, keep high-signal checks on the areas you touch, and run full static and runtime verification before calling it done.

This holds when no external consumer depends on backward compatibility. A public API, a published package, or a wire format with deployed clients needs a versioned path. Say so and plan the deprecation.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-migrate-callers-then-delete-legacy-apis` and `principle-outcome-oriented-execution` (MIT, Copyright (c) 2026 Lauren Tan).
