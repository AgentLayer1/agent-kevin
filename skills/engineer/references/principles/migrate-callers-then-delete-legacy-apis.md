# Migrate callers, then delete legacy APIs

**Apply when:** introducing a new internal API while old callers still exist.

- **One wave.** Inventory the callers, migrate them, and delete the old API in the same wave. Don't keep a compatibility path only because internal callers still exist.
- **Adapters are exceptions.** A temporary adapter is time-boxed and named as temporary, never default architecture.
- **Parameterize without breaking.** A new parameter defaults to the old hardcoded value, so existing callers keep their behavior without edits.
- **Tests follow the contract.** Update tests to assert the new contract, and delete tests that only protect pre-refactor internals.

Dual paths make the codebase feel append-only and slow every later cleanup. For the migration itself, see [outcome-oriented execution](outcome-oriented-execution.md).

This holds when no external consumer depends on backward compatibility. A public API, a published package, or a wire format with deployed clients needs a versioned path. Say so and plan the deprecation.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-migrate-callers-then-delete-legacy-apis` (MIT, Copyright (c) 2026 Lauren Tan).
