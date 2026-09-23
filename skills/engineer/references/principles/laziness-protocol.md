# Laziness protocol

**Apply when:** refactoring, sizing a diff, or tempted to add an abstraction, a layer, or a signal threaded through several layers.

The most result for the least code and complexity.

- **Prefer deletion.** Asked to refactor or improve, look for removals before additions.
- **Keep the call hierarchy flat.** If answering one question means tracing more than three files or layers, flatten it. A rich interface that hides substantial work is not a deep call chain.
- **Consolidate decisions.** Don't repeat the same choice in several places. Put it behind one source of truth and pass the result as a simple value.
- **Minimize the diff.** Make the smallest change that solves the problem. Fewer lines beat elegant boilerplate.
- **Question the threading.** When a new signal has to travel through types, schemas, pipelines, or similar layers, stop and look for a more direct path.
- **Sweat the small leaks.** Remove tiny pass-throughs, representation leaks, and duplicated choices before they spread. Small leaks compound into permanent coordination costs.

**The test:** if a human would find the code exhausting to maintain, it's the wrong solution.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-laziness-protocol` (MIT, Copyright (c) 2026 Lauren Tan).
