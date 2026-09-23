# Arena

N parallel attempts at the same task; read every one; pick the strongest as the base; graft the best ideas from the rest; verify the result. Use it when one attempt at a non-trivial artifact would lock in the wrong shape ("arena this", "give me competing designs"). It powers [architect](architect.md)'s sketch step and [eval](playbooks/eval.md)'s candidates. For coverage of separate slices, use [swarm](swarm.md) instead.

1. **Frame.** The candidates get the same prompt, so the prompt is the contract. State the artifact, then turn "what good looks like" into 3 to 6 gradeable criteria. The rubric is for picking; candidates see only the task. Give each candidate its own output location: a worktree, or its own `mktemp -d` directory ([separate before serializing shared state](principles/separate-before-serializing-shared-state.md)).
2. **Fan out.** Launch all N subagents at once, each with the task, the shared grounding, its output path, and an instruction to return the artifact plus a short rationale naming what it considered and rejected. Diversity helps: vary the model where your host allows it, or get a different family's candidate through the adversarial-review skill or a second host. Same-model candidates still diverge when each is told to commit to its best shape rather than a safe middle. If one fails, proceed with N-1 and note it.
3. **Cross-judge.** After every candidate is done, one read-only judge (a different model family when possible) scores each against the rubric by neutral label and recommends a base.
4. **Pick a base.** Read every candidate end to end and score it criterion by criterion, not on holistic feel. Compare with the judge: agreement confirms; disagreement means bias or an ambiguous rubric, so read both rationales. Pick the one a future maintainer can extend most easily without breaking invariants; on a tie, the smaller API or cleaner boundary wins ([laziness protocol](principles/laziness-protocol.md)).
5. **Graft.** Walk each losing candidate once more for the one or two ideas worth porting. Fold them in by hand so the result stays coherent under one mental model ([redesign from first principles](principles/redesign-from-first-principles.md)). When all candidates converge, ship the consensus shape. When they wildly diverge, the framing was underspecified, so reframe and rerun rather than averaging.
6. **Verify** the synthesized artifact like any other output ([prove it works](principles/prove-it-works.md)). A problem the arena missed means either the framing was wrong (rerun) or a candidate caught it and the graft missed it (go back to step 5).

**Output:** one artifact plus a short synthesis note: the base, the grafts and their source, the rejections, any dropouts, and the verification result.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `arena` skill (MIT, Copyright (c) 2026 Lauren Tan).
