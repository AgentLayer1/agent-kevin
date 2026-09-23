# Feature

**You own the design.** Plan, build, and verify.

1. Learn how the affected subsystem works (a compressed [investigation](investigation.md)) and read the repo manual's conventions.
2. Name the data shape and its organizing structure before writing any logic ([model the domain](../principles/model-the-domain.md), [foundational thinking](../principles/foundational-thinking.md)). If the work crosses a function boundary, sketch it first ([architect](../architect.md)). If the right shape isn't obvious, design it twice ([exhaust the design space](../principles/exhaust-the-design-space.md)).
3. Write the throughput checkpoint as four todo items. A dimension that doesn't apply keeps its line as `n/a: <reason>`.
   - **Blocking first steps:** what has to land before anything else (scaffold, types, migrations).
   - **Independent workstreams:** disjoint files or layers that can proceed in parallel.
   - **Shared mutable state:** split the target first ([separate before serializing shared state](../principles/separate-before-serializing-shared-state.md)). Serialize only for a real invariant.
   - **Smallest safe decomposition:** if one worker is best, say why.
4. Subtract before you add. Delete what the new shape makes dead before building on it ([subtract before you add](../principles/subtract-before-you-add.md)).
5. Build in small verified units and commit per phase ([sequence verifiable units](../principles/sequence-verifiable-units.md)). Keep the diff surgical: every changed line traces to the request. When you improve a shared primitive, port the improvement to every consumer and verify each.
6. Verify the real feature path end to end on the matching surface ([prove it works](../principles/prove-it-works.md)). Flag widgets, notifications, and background work that the simulator undersells for device dogfood instead of implying they were verified.
7. If the design is contested, get a second model on it with the adversarial-review skill before handoff.
8. Run the [comment pass](../comment-pass.md), then follow [handoff](../handoff.md).

**Reply:** what you built and for whom, the choices you made and why (a table when there were real alternatives), the throughput checkpoint, how you verified it, and any open decisions.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) feature playbook (MIT, Copyright (c) 2026 Lauren Tan).
