# Session pickup

**You own the resume point.** Read the prior trail; don't redo it. Use it to take over in-flight work from an earlier session, another agent, or a pushed branch.

1. **Locate the trail.** The find-session skill finds the session by what it worked on; where-am-i lists recent ones with resume commands. Read the checkpoint and the last messages first, then scan back for the decision points. Parse a long transcript in a subagent and keep only the reduced timeline.
2. **Reconstruct the state:** the branch and worktree, what already landed (`git log` and `git diff` against the base), open tasks, and the decisions made. The prior trail is authoritative input. Resist re-deriving it.
3. **Diff done against pending.** Name the resume point. Don't rerun the prior repro or redo finished work; a "verify everything from scratch" pass treats an authoritative trail as untrustworthy.
4. **Route the remaining work** to the matching playbook: continue it, ship a finished recommendation, ratify or overturn a prior conclusion, or write the postmortem of a failed run.
5. **Verify the inherited claims** against the original goal on the real artifact ([prove it works](../principles/prove-it-works.md)). A passing self-report from the prior session is not the proof.

**Reply:** where the prior work stopped, what you inherited versus redid (ideally nothing), the resume point, and the outcome.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) session-pickup playbook (MIT, Copyright (c) 2026 Lauren Tan).
