# Swarm

N parallel workers, drained and aggregated into one report. Use it for coverage (one worker per package, per feature, per file), races (N workers on the same brief with a declared selection rule), gauntlets, or partitioned exploration ("swarm this", "one worker per package"). For competing designs of one artifact, use [arena](arena.md).

1. **Frame.** State the done predicate and the report the swarm must return. Choose the shape: slices, a race, or both. For a race, declare the selection rule up front: first pass, rank all, or best-of. N is the number of workers, not the concurrency limit.
2. **Brief every worker so it stands alone:** the goal, its exact slice or race arm, how to verify, and what to report. When workers verify commits, name the exact SHAs; when they measure, name the method (sample count, what one sample is, order). A worker that writes gets its own output location.
3. **Launch them together** and let them run. Each reports `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect lists every one it can prove, not just the first.
4. **Aggregate.** Drop a result that doesn't record the SHAs and method its brief named, rerun that worker once, and record a gap after a second miss. A gap is not a pass. Coverage needs a result for every slice; a race applies its declared rule.
5. **Report once:** a compact result table, one-line evidenced issues, gaps and dropouts, and the race rule when used. No raw worker dumps ([guard the context window](principles/guard-the-context-window.md)).

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `swarm` skill (MIT, Copyright (c) 2026 Lauren Tan).
