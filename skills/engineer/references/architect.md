# Architect

Design before code. Use this for code that crosses a function boundary, or whenever jumping straight to code would lock in the wrong shape ("architect this", "design this first"). Sketch the types, signatures, and module shape with unimplemented bodies, settle the shape, then fill it in. By default the synthesized sketch goes straight to implementation; when the operator asks for a checkpoint ("architect with checkpoint", "show me before implementing"), stop and show it first.

1. **Ground.** Know every system the new code touches ([investigation](playbooks/investigation.md)). If the design changes ownership or layering, read the history of the current shape so its rationale becomes a constraint instead of a guess.
2. **Write the caller's usage first:** the README or quickstart a consumer reads, plus two or three real call sites. Derive the types from the usage. When the two disagree, fix the types.
3. **Sketch at least two structurally different shapes** ([exhaust the design space](principles/exhaust-the-design-space.md)), ideally as an [arena](arena.md) of parallel candidates. Each should be a whole-shape alternative, not a tweak inside one shape. Every candidate follows the same discipline:
   - The caller's usage first; the types derive from it.
   - Data structures first. Trace each dominant access pattern; "we'll add an index later" means the structure is wrong.
   - Interface depth: pull complexity into the callee; no transport or wire types on the public API.
   - Shared state: if two actors might write, default to per-actor state merged at the read boundary ([separate before serializing shared state](principles/separate-before-serializing-shared-state.md)).
   - Visible boundaries: `not implemented` bodies, pseudocode for tricky logic, and doc comments stating invariants, so a reader traces data from input to output through signatures alone.
   - Invariants in types over runtime checks over prose ([encode lessons in structure](principles/encode-lessons-in-structure.md)); validate at boundaries ([boundary discipline](principles/boundary-discipline.md)); one source of truth per invariant, derived not synced; idempotent state transitions ([make operations idempotent](principles/make-operations-idempotent.md)); call chains no deeper than three files ([laziness protocol](principles/laziness-protocol.md), [minimize reader load](principles/minimize-reader-load.md)).
   - Each candidate commits to its best design rather than hedging toward a safe middle; the differences are the signal.
4. **Screen each shape against the red flags:**
   - **Shallow module:** a large interface hiding little, so callers coordinate several methods for one operation.
   - **Information leakage:** one internal decision (a representation, a protocol detail) known in several modules, or wire and storage types on the public surface.
   - **Temporal decomposition:** modules split by execution order (load, validate, save) instead of by the knowledge they own.
   - **Pass-through method:** a method that forwards the same arguments to another method with the same shape.
5. **Pick on interface depth:** the most complexity hidden behind the smallest, simplest surface. Trace each dominant access pattern through the chosen structure.
6. **Implement against the sketch.** A deviation, such as a parameter the sketch didn't plan for, is a signal. Ask whether the sketch was wrong, the requirement was missed, or the implementation is overreaching.
7. **Scrap the sketch when the friction is a pattern,** not a one-off:
   - the same workaround in unrelated places;
   - casts or always-set optionals needed to compile;
   - a lock the sketch said wasn't needed;
   - callers who have to know the internals.

   Redesign smaller, as if the new constraints had been day-one assumptions ([redesign from first principles](principles/redesign-from-first-principles.md), [subtract before you add](principles/subtract-before-you-add.md)). Reground, then rerun step 3.

When the operator pushes back on the shape, treat it as new grounding evidence and rerun step 3 before writing more code. The synthesized sketch can land as its own commit (the scaffold before the fill-in), and planned breakage during fill-in is fine ([outcome-oriented execution](principles/outcome-oriented-execution.md)).

For a contested, hard-to-reverse design, [interrogate](interrogate.md) the sketch, or send it to a second model with the adversarial-review skill, before building.

## The rationale that ships with it

A non-trivial sketch carries one page of rationale in the plan, the spec, or the PR description:

- **Problem:** what the code must do, and the constraints that make the shape non-obvious.
- **Usage:** the caller's view from step 2.
- **Shape:** data structures first, then where validation lives, what the interface hides, and what the design deliberately doesn't do.
- **Tradeoffs accepted:** one line each, in the form "we accept X in exchange for Y".
- **Synthesis decision:** which candidate became the base and why, what was grafted from the others, and what was rejected.
- **Alternatives considered:** at least one real whole-shape alternative and why it lost, judged on interface depth, or "this was the only viable shape because…".
- **Open questions and risks:** phrased as questions the operator can answer.
- **Next step:** the first thing you'd build against the sketch, in one sentence.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `architect` skill and its references (MIT, Copyright (c) 2026 Lauren Tan).
