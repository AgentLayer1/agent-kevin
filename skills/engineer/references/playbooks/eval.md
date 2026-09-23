# Eval

**You own the experiment design.** Test how a skill, prompt, or structure change affects behavior before promoting it. The enemy is the observer effect: an agent that knows it's being evaluated behaves differently.

**Blinding rules:**

- No `eval`, `test`, `judge`, `rubric`, `score`, `compare`, `benchmark`, `candidate`, or `arena` in any directory, file, or prompt a candidate sees.
- The candidate prompt reads like an organic request: the goal, not the meta.
- Don't ask candidates which skills or principles they applied. Grade chain-following from the files they actually opened (their transcripts) and the shape of the result, never self-report.
- Use project-shaped directory names, and never tell a candidate that others exist.
- The judge knows it is judging but sees outputs only by neutral label, never by model. Comparing two variants, one judge scores both sets in one pass on one scale.

**Steps:**

1. **Frame** the variant under test and what success looks like. Write a rubric of 3 to 6 concrete criteria for the judge only.
2. **Set up sanitized environments,** one per candidate, with the variant in place and the context an organic task would have.
3. **Write one organic prompt.**
4. **Run N candidates in parallel** ([arena](../arena.md)), each in its own directory. Different models where available.
5. **Run one blinded judge,** from a different model family when possible.
6. **Verify the chain from transcripts,** not self-report.
7. **Read every output yourself,** end to end, before accepting the judge's verdict. A disagreement means a biased model or an ambiguous rubric; suspect the rubric first.

**Reply:** the variant, the rubric, per-candidate notes, the judge's verdict, your synthesis, and whether to promote the variant.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) eval playbook (MIT, Copyright (c) 2026 Lauren Tan).
