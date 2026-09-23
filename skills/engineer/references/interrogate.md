# Interrogate

Several reviewers attack the same change from independent angles, and the lead sorts what survives. Use it for "tear this apart", "stress-test this", or a contested design before shipping. Within one session, reviewers are parallel subagents. For model diversity, which is where the adversarial signal really comes from, run a cross-model round with the adversarial-review skill.

1. **Scope:** the files or diff the operator named, or `git diff <base>...HEAD` on a branch. Package the diff plus the context files reviewers need.
2. **State the intent** in one paragraph from the request, commit messages, PR body, and code. If you're unsure of it, ask before spawning.
3. **Spawn the reviewers together,** each read-only, with the same prompt:
   - The intent, which they don't question; they challenge the execution.
   - The code under review.
   - The rubric: correctness (edge cases, error handling, state, idempotency, concurrency), root causes versus symptoms (guards that mask a violated invariant, retries that hide a broken contract, casts that silence a modeling error, instructions where structure belongs), structural integrity (validation at boundaries, abstraction level, coupling, data-model fit, bolted-on versus integrated, legacy dual paths), verification (tests that observe behavior, the real artifact checked), the complexity budget, and traceable security.
   - The code-quality lens: be ambitious about structure. Look for the reframing that deletes whole branches, modes, or helpers; flag spaghetti growth, thin wrappers, cast-heavy contracts, logic in the wrong layer, and a file pushed past 1,000 lines. A few high-conviction findings beat a flood of nits.
   - Each finding carries a severity (`critical`, `warning`, `nit`), the location, what's wrong, the evidence, and optionally a concrete fix. "No findings" is a valid review. No praise, no "I would have done it differently".
4. **Synthesize.** Parse every finding, merge duplicates across reviewers, and note which raised each. Findings raised independently by two or more reviewers are the strongest signal. Record disagreements.
5. **Judge as the lead, not an aggregator.** You have the context the reviewers lacked. Filter:
   - **Nitpick gravity:** reviewers fill space, so a review that's all nits means the code is probably fine.
   - **Hypothetical versus actual:** "what if this is null" counts only if a caller can pass null. Trace it.
   - **Premature abstraction:** a suggested extraction with one caller isn't a finding.
   - **Preference:** "I'd have done it differently" without a concrete cost is dismissed.
   - **Missing context:** code the author didn't touch, or a pattern consistent with the rest of the codebase.
   - Be slow to dismiss correctness and security findings, even from one reviewer.

**Output:** the intent; the reviewers and their finding counts; **Act on** (would block a real PR; five or fewer, or you're not filtering), **Consider** (legitimate, cost unclear), **Noted** (valid, not actionable now), **Dismissed** (with a one-line reason each, so the operator can overrule you); and an agreement map. Apply nothing automatically.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `interrogate` skill and its rubric, code-quality, and lead-judgment references (MIT, Copyright (c) 2026 Lauren Tan).
