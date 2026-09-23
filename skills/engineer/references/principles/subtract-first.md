# Subtract first

**Apply when:** sizing a diff, refactoring, sequencing an addition, or feeling the pull toward a new layer, option, or abstraction.

The most result for the least code. Remove before you build.

- **Delete before you add.** On any refactor or improvement, look for removals first: dead code, redundant validators, stub references, flags whose migration finished. Then build on the simpler base.
- **Smallest change that solves the problem.** Fewer lines beat elegant boilerplate. Get to the minimum before polishing.
- **Keep the call chain flat.** If answering one question means tracing more than three files or layers, flatten it. A rich interface that hides real work is not a deep chain.
- **One decision, one place.** Don't repeat a choice across files. Put it behind one source of truth and pass the result.
- **Question the threading.** When a new signal has to travel through types, schemas, and pipelines, stop and look for a more direct path.
- **Design for observed usage.** No speculative guards, parsers, or knobs beyond what the spec demands.
- **Sweat the small leaks.** Pass-throughs, representation leaks, and duplicated choices compound into permanent coordination costs.

**The test:** would a human find this exhausting to maintain? Then it's the wrong solution. After the change, is the design simpler and at least as capable behind the same or a smaller surface?

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-laziness-protocol` and `principle-subtract-before-you-add` (MIT, Copyright (c) 2026 Lauren Tan).
