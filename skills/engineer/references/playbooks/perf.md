# Performance

**You own the measurement.** Tie every change to a number. Don't read source instead of measuring.

1. Reproduce the slowness with a realistic workload (data size, history, concurrency) and capture a baseline: a profile, a trace, or a timed command sampled enough times to beat the noise (the median of N runs).
2. Ground each hypothesis in how the code works and in the trace. Eight families generate candidates, and one earns an attempt only when the trace shows its signal.
   - **Elimination:** does the hot work need to exist at all? The trace shows what's slow, never what's deletable, so this family needs reading, not profiling.
   - **Divide and conquer:** cost scales with input. Chunk, shard, prune, or parallelize.
   - **Caching:** identical work repeats. Name what invalidates the cache before claiming the win.
   - **Indirection:** an index instead of a scan, or a queue that moves work off the interactive path.
   - **Batching:** many small calls each pay a fixed overhead. Coalesce them.
   - **Redundancy:** the wait hangs on one slow attempt. Hedge only when there is headroom.
   - **Lazy evaluation:** cost lands on results nobody needs yet. Defer it.
   - **Scheduling:** the work has to happen, but not while someone waits. Move it to idle time or the background.
3. One change, one measurement, keep or revert. Never stack untested changes. Accept a change only when it moves the number past the noise with the regression tests green, and revert everything else in full.
4. For a sustained push toward a target rather than a one-off fix, switch to [hillclimb](hillclimb.md).
5. Run the [comment pass](../comment-pass.md), then follow [handoff](../handoff.md) with the primary number in the PR description.

**Reply:** the baseline, the result, the delta with its unit, the artifact paths, and the next idea you'd try.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) perf-issue and hillclimb playbooks (MIT, Copyright (c) 2026 Lauren Tan).
