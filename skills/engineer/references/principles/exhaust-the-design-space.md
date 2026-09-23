# Exhaust the design space

**Apply when:** a novel interaction or an architectural choice has no precedent in the codebase and more than one viable shape.

Building the wrong thing costs more than exploring three options. Design it twice: sketch two or three structurally different shapes (not variations on one shape), compare them side by side, then commit.

- For a visual or behavioral decision, build throwaway prototypes behind one switcher ([prototype](../playbooks/prototype.md)).
- For an architectural decision, sketch types and signatures for each shape and screen them against the red flags in [design](../design.md).
- Judge on interface depth: which shape hides the most complexity behind the smallest surface?

Skip it for mechanical work that follows an established pattern, for bug fixes and refactors with a clear target, and when constraints leave one viable shape. In that last case, say which constraints forced it.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-exhaust-the-design-space` (MIT, Copyright (c) 2026 Lauren Tan).
