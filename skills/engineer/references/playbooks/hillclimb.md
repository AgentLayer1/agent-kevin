# Hillclimb

**You own the metric and the experiment's integrity.** Sustained, scientific improvement of one measurable thing against a target. A one-off fix is [performance](perf.md) or [bug fix](bug-fix.md); this is the loop.

The discipline: one change, one measurement, keep or revert. Never stack untested changes, and never claim a win from reading code ([prove it works](../principles/prove-it-works.md)).

1. **Ground the workload first.** Learn how the target works ([how](how.md)), name the workload dimensions that move the result (data size, history, state, concurrency), and pick a case that reproduces the complaint. If nothing reproduces it, fix the repro before climbing.
2. **Fix the metric, the direction, and a stop predicate** that pairs a target with a floor on attempts ("at least 50% better and at least 10 iterations"), so a lucky early win can't end the run. Use the operator's numbers when given.
3. **Build the harness, prove it, then freeze it** ([build the lever](../principles/build-the-lever.md)). Run contrasting workloads and confirm the target case shows the symptom while easy cases separate. One repeatable command emits the metric, sampled enough to clear the noise (median of N). Record the baseline and a green run of the regression tests before any change.
4. **Open a decision log** ([decision log](../decision-log.md)): one row per attempt with hypothesis, change, before, after, delta, tests, verdict, note. Read it before each attempt.
5. **Ground each hypothesis in a mechanism** ("defer X off the boot path because it blocks first paint"), not "try memoizing something". The [performance](perf.md) strategy families generate candidates.
6. **Loop, one hypothesis per iteration.** Hand independent hypotheses to parallel subagents, each in its own worktree ([separate before serializing shared state](../principles/separate-before-serializing-shared-state.md)). Measure before and after with the frozen harness and run the regression tests. Accept only a move past noise with tests green, and revert everything else in full. One commit per accepted win, staging only the files it touched. Log the row either way.
7. **Push past the first plateau.** Several rejects in a row means pivot category, combine near-misses, reread the source, or try something more radical. Correctness and simplicity outrank the number: revert a win that breaks behavior, keep a simplification that holds the number.
8. **Stop** when the predicate is met, or when the remaining ideas are marginal. Never relax the predicate to meet it, and don't quit while cheap untried hypotheses remain. Stuck means surface it, not spin.

**Reply:** the metric and target, baseline to final with the percent delta, iterations kept and reverted, each accepted win in one line, the decision-log path, and the next idea you'd try.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) hillclimb playbook (MIT, Copyright (c) 2026 Lauren Tan).
