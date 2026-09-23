# Redesign from first principles

**Apply when:** integrating a new requirement into an existing design.

Don't bolt the change onto the existing design. Redesign as if the requirement had been there from the start.

- Read every affected file and understand the current design first.
- Ask: if we were writing this from scratch with this requirement, what would we build?
- Propagate the change through every reference: types, docs, examples, tests, and rationale sections.
- When a design has piled up band-aids, each patching the last, stop patching: rewrite it around what the requirements are now.
- Think through the whole redesign, then deliver it in increments ([sequence verifiable units](sequence-verifiable-units.md)).

This is how a design keeps its option value while it changes. It differs from [attack the premise](attack-the-premise.md), which questions a fact the current design assumes rather than rebuilding around a new requirement.

**The test:** after the change, does the code read as if the design always accounted for the requirement?

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-redesign-from-first-principles` (MIT, Copyright (c) 2026 Lauren Tan).
