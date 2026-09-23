# Bug fix

**You own the fix and its evidence.** Every shipped line traces to runtime evidence. A change that "might help" is a hypothesis, and it doesn't ship.

1. Reproduce the bug yourself on the surface where it was reported: browser, simulator, device, CLI, or API. Ask the operator only after driving the tools as far as they go, and name the reason they can't reach it. If the bug won't fire, synthesize the trigger, tighten the conditions, or instrument until it does.
2. Binary-search the cause. List the candidate hypotheses, seeded from how the code works and from `git log` on the area. Each pass, take the split that cuts the most remaining space, get runtime evidence, and eliminate. When state is unclear, add logging and read it as the code runs ([fix root causes](../principles/fix-root-causes.md)).
3. Confirm the surviving mechanism with evidence before writing the fix. If two fixes on the same premise have failed, attack the premise.
4. Write the failing test first when a cheap local test path exists. Run it and see it fail for the right reason ([sequence verifiable units](../principles/sequence-verifiable-units.md), [test behavior](../principles/test-behavior-not-implementation.md)). Otherwise say why, and keep the repro command as the check.
5. Make the smallest fix the evidence justifies, at the cause. If it crosses a function boundary, sketch it first ([design](../design.md)). Grep for the same pattern elsewhere.
6. Verify on the same surface: the original repro now passes. Unit tests show branch behavior, not the absence of the bug. A wrong-surface or inconclusive result is not a pass.
7. Revert anything an eliminated hypothesis motivated. Run the [comment pass](../comment-pass.md). Commit the failing test before the fix, then follow [handoff](../handoff.md).

**Reply:** what was broken, the root cause, the fix, and how you verified it. Paste the failing-then-passing output verbatim.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) bug-fix playbook and the `tdd` skill (MIT, Copyright (c) 2026 Lauren Tan).
