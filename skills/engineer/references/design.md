# Design before code

Use this for code that crosses a function boundary, or whenever jumping straight to code would lock in the wrong shape. Sketch the types, signatures, and module shape with unimplemented bodies, settle the shape, then fill it in.

1. **Ground.** Know every system the new code touches ([investigation](playbooks/investigation.md)). If the design changes ownership or layering, read the history of the current shape so its rationale becomes a constraint instead of a guess.
2. **Write the caller's usage first:** the README or quickstart a consumer reads, plus two or three real call sites. Derive the types from the usage. When the two disagree, fix the types.
3. **Sketch at least two structurally different shapes** ([exhaust the design space](principles/exhaust-the-design-space.md)). Each should be a whole-shape alternative, not a tweak inside one shape.
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

   Redesign smaller, as if the new constraints had been day-one assumptions.

For a contested, hard-to-reverse design, send the sketch to a second model with the adversarial-review skill before building.

## The rationale that ships with it

A non-trivial sketch carries one page of rationale in the plan, the spec, or the PR description:

- **Problem:** what the code must do, and the constraints that make the shape non-obvious.
- **Usage:** the caller's view from step 2.
- **Shape:** data structures first, then where validation lives, what the interface hides, and what the design deliberately doesn't do.
- **Tradeoffs accepted:** one line each, in the form "we accept X in exchange for Y".
- **Alternatives considered:** at least one real whole-shape alternative and why it lost, or "this was the only viable shape because…".
- **Open questions and risks:** phrased as questions the operator can answer.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `architect` skill (MIT, Copyright (c) 2026 Lauren Tan).
