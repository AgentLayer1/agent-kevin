# Subtract before you add

**Apply when:** sequencing an addition, a refactor, or a rewrite.

Remove complexity first, then build. Adding to a complex system compounds the complexity. Removing first leaves less code, reveals the essential structure, and usually makes the next design obvious.

- **Removal before construction.** Delete dead code, redundant validators, stub references, and flags whose migration finished, then build on the simpler base.
- **Cut before you polish.** Get to the minimum before investing in quality.
- **Design for observed usage,** not speculative edge cases. No validators, parsers, or guards beyond what the spec demands.
- **Simplify prompts too.** Remove redundant instructions and oversized templates from skills and manuals.
- **No stubs.** When a reference has no novel content, delete it rather than leaving a stub.
- **Make it continual.** Leave the design slightly simpler and more capable, behind the same or a smaller surface than you found it.

**The test:** after the change, is there less to understand than before, for the same or more capability?

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-subtract-before-you-add` (MIT, Copyright (c) 2026 Lauren Tan).
