# Minimize reader load

**Apply when:** shaping or reviewing code that's hard to trace, or before adding a layer or a piece of state.

Maintainability is the work a reader does to understand the code. Track two independent axes: the layers between a question and its answer, and the hidden or mutable state the reader has to hold in their head. Line counts and "clean architecture" are proxies for these.

- **Collapse layers that cost more than they save:** one-caller wrappers, adapters with no second implementation, indirection that was never needed. Inline them.
- **Adjacent layers must change the abstraction.** A layer that repeats the same methods and arguments adds load without compressing anything.
- **Prefer deep modules.** A small interface that hides real decisions beats a broad one that makes the reader learn both the surface and the implementation.
- **Shrink state scope:** returns over mutation, locals over fields, fields over module state, module state over globals. Derive values instead of syncing them.
- **Name an invariant once,** at the boundary, not in every consumer.

Before adding a layer or a piece of state, ask whether it cuts reader load elsewhere by at least as much.

**The test:** can a new reader answer "where does X come from?" and "what can change X?" in under 30 seconds?

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-minimize-reader-load` (MIT, Copyright (c) 2026 Lauren Tan).
