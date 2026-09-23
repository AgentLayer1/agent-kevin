# Prototype

**You own the decision, not the code.** The prototype is a throwaway instrument. The real build follows the [feature](feature.md) playbook.

Use a prototype to settle a fork by observing instead of asking: which layout, which interaction, which approach, or whether a timing or behavior holds.

1. Name the decision the prototype exists to make. No decision, no prototype.
2. Build in an isolated scratch directory (`mktemp -d`), away from production source. For a visual question, use plain HTML, CSS, and JS, or the lightest stack that renders the idea. For a behavioral question, write the smallest script that exercises it. No tests, no abstractions. Speed beats polish here.
3. When comparing alternatives, build them behind one switcher with each variant labeled ([exhaust the design space](../principles/exhaust-the-design-space.md)).
4. Observe on the matching surface: screenshot each variant with the browser tools, or log the timing and output. The observation is the test.
5. Present the variants, the evidence, the tradeoffs, and a recommendation, then hand the chosen direction to the feature playbook.

If the sandbox blocks listening on a port, render static files with the browser tools, or hand the operator the one command that serves it.

**Reply:** the variants, the evidence, the tradeoffs, your recommendation, the scratch path, and a plain statement that the prototype is throwaway.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) prototype playbook (MIT, Copyright (c) 2026 Lauren Tan).
