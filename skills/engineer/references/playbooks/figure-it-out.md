# Figure it out

**You own a bespoke, auditable playbook** for work no other playbook fits: a large migration, an ambitious multi-part change, or anything the operator will review after stepping away. The deliverable before any code is the workflow itself.

1. **Frame.** Ground first ([how](how.md)), then state:
   - **the definition of done** as a falsifiable predicate ([prove it works](../principles/prove-it-works.md));
   - **the scope, quantified** (rough units and effort, plus the blockers grounding surfaced);
   - **the rigor level, biased high.** One-way doors and a wide blast radius get more gates; reversible low-stakes steps get fewer. Rigor means gates and artifacts, not "try harder".

   Present the framing and tradeoffs before a long run. Reversible work proceeds, but a multi-hour run earns one checkpoint.
2. **Design the workflow.** Decompose into atomic, independently landable units. Sequence the riskiest unknown first, and put scaffold and verification before features ([foundational thinking](../principles/foundational-thinking.md)).
   - Build the verification harness before the work, with the baseline captured from the pre-change state, so each check reads "old value against new".
   - A one-way-door design goes through [architect](../architect.md). Mechanical work with a settled shape doesn't need it ([laziness protocol](../principles/laziness-protocol.md)).
   - Parallelize only across real seams, one worktree or branch per worker ([separate before serializing shared state](../principles/separate-before-serializing-shared-state.md)).
   - Write the phase list down. That list is what the operator reviews.
3. **Run the loop.** Each unit is an experiment: state the hypothesis, make the smallest change, measure against the predicate on the real artifact, and keep it or revert it ([sequence verifiable units](../principles/sequence-verifiable-units.md)).
   - Verify by inspecting artifacts, never self-reports. When something passes too easily, suspect the observation first.
   - Audit delegates' output yourself. If a worker games the gate, reset it and harden the contract. If the gate itself is wrong, fix the gate as its own change.
   - A verdict is VERIFIED, NOT VERIFIED, or INCONCLUSIVE. Inconclusive is not a pass. Don't hide a negative.
4. **Keep the trail.** Log every decision point in the [decision log](../decision-log.md) as it lands, not at the end.
5. **Verify and hand back.** Check the whole against the predicate on the real product, not just the harness. Encode any recurring correction as a gate, a test, or a script ([encode lessons in structure](../principles/encode-lessons-in-structure.md)).

**Reply:** the playbook you designed, the rigor level and why, the decision-log path, what's verified against the predicate, and what's still open.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `figure-it-out` skill (MIT, Copyright (c) 2026 Lauren Tan).
