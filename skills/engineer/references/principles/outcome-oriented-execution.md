# Outcome-oriented execution

**Apply when:** running a planned rewrite or migration with explicit phase boundaries.

Optimize for the intended, verifiable end state rather than preserving smooth intermediate states. Keeping every step fully stable breeds temporary compatibility code, and temporary code becomes long-lived debt.

- **End-state integrity over transitional stability.** Converge on the target architecture.
- **Planned breakage is allowed** when it is scoped and reversible. Declare where it is acceptable before starting.
- **Keep high-signal checks** on the areas you actively touch while migrating.
- **Verify fully at the end.** Static and runtime verification of the whole before calling it done ([prove it works](prove-it-works.md)).

Pairs with [migrate callers, then delete legacy APIs](migrate-callers-then-delete-legacy-apis.md), which says what to do with the old surface once the target exists.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-outcome-oriented-execution` (MIT, Copyright (c) 2026 Lauren Tan).
