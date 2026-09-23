# Foundational thinking

**Apply when:** choosing core types and data structures, sequencing scaffold against feature work, or folding a new requirement into an existing design.

- **Data structures first.** Define the core types early, trace every access pattern through them, and pick structures that match the dominant paths. If the answer to an access pattern is "we'll add an index later", the structure is wrong.
- **Scaffold first.** Whatever helps every later phase goes first: CI, lint, the test harness, shared types, a baseline measurement. Subtraction comes before scaffolding.
- **DRY the structure, not every line.** Types and models converge. Three similar statements still beat a premature abstraction. Explicit beats clever.
- **Ask what concurrent actors share.** Before sharing state, ask what happens if another actor modifies it at the same time. If the answer isn't "nothing", isolate it ([separate before serializing](separate-before-serializing.md)).
- **Redesign, don't bolt on.** When a requirement lands, read every affected file and ask: if this had been a day-one assumption, what would we have built? Propagate it through types, docs, examples, and tests. Think through the whole redesign, then deliver it in increments.
- **A shared package earns its place.** Split out a workspace package or a monorepo when three or more modules are duplicated, one app calls the other synchronously, and they deploy as a unit. Before that, the boundary costs more than the duplication.
- **Each increment lands a coherent abstraction or deepens one.** Don't spread a new capability across callers as special cases.

**The test:** after the change, does the code read as if the design always accounted for the requirement?

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-foundational-thinking` and `principle-redesign-from-first-principles` (MIT, Copyright (c) 2026 Lauren Tan).
