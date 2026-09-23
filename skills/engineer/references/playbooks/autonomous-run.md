# Autonomous run

**You own the exit condition.** Define done, then drive to it without stopping. Use it when the operator steps away ("keep going until…", "I'm going to bed").

1. **State the exit condition as a checkable predicate** before the first iteration: tests green, the repro fixed, the checker reports zero old callers. A duration is not a predicate. "Work on this for four hours" gives nothing to check.
2. **Pick the wake mechanism.** For an event you can watch (CI, a merge, a ref moving), watch it, with a long heartbeat as the fallback. With no event, use a fixed interval sized to when the result is worth rechecking: `/loop` or a scheduled wakeup in Claude Code, or the equivalent on your host.
3. **Each iteration:** the smallest change the evidence justifies, verified against the predicate, kept if it advanced and discarded if it didn't ([sequence verifiable units](../principles/sequence-verifiable-units.md)). A "might help" change gets reverted, not left to ride.
4. **Mid-run discoveries are yours.** Fix reversible problems you trip over (a flaky check, a broken skill, drift) as their own change, then return to the predicate. Surface only what the manual's ask-first list reserves (pushes, releases, deletions, outbound messages), a product call no experiment settles, or a genuine dead end ([never block on the human](../principles/never-block-on-the-human.md)).
5. **Log every iteration** in the [decision log](../decision-log.md): what changed and whether the predicate moved.
6. **Stop when the predicate is met.** A plateau is not a stop; pivot and push past it. Never relax the predicate to declare victory. At a real dead end, stop and write up why instead of reinterpreting the goal.

The operator's "don't ask me before committing" widens what proceeds for this run only. Pushing, tagging, and releasing stay theirs.

**Reply:** the exit condition, iterations run, what landed, what was discarded, and the final predicate state.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) autonomous-run playbook and the overnight guide (MIT, Copyright (c) 2026 Lauren Tan).
