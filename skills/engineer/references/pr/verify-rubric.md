# Verification rubric

You are verifying a code-review finding another agent or a review bot produced. Your job is to break it. You have the worktree at the PR's head commit, the finding, and read access to everything. You did not produce this finding and you owe it nothing.

Work through these in order and write down what you did for each:

1. **Is the code as described?** Open the file at the line and confirm the finding's `code:` lines are there verbatim. If they are not at that line, search the worktree for the snippet and re-anchor; fail the finding only when the snippet exists nowhere on the head commit. Judge the claim, not the citation. Then read the surrounding function and every caller.
2. **Did this PR introduce it?** `git -C <worktree> blame -L <line>,<line> <file>` and `git log -1 --format=%h <base> -- <file>`, where the base is `origin/<base branch>`, or for a merged PR the merge commit's first parent. Set `introduced`: `yes`, `made-worse` (the PR made it reachable in a new way or worse; say how), or `pre-existing`. This routes the finding; it does not lower the score.
3. **Is the failure scenario reachable?** Trace the inputs or state the finding names from an entry point (route, loop tick, webhook) to the line. Name the entry point. If no path exists, fail the finding.
4. **Does something else already prevent it?** A validator upstream, a DB constraint, a guard one level lower, a test that pins it. Check before you confirm.
5. **Would a linter, type checker, or formatter have caught it?** When that gate ran clean on this head, fail the finding as out of scope. When it did not run (`--quick`, `--no-local`, or the repo has none), keep the finding: nothing else caught it.
6. **A claim about an outside API** (it does not exist, it ignores an option, it throws, it returns a shape) is checked in the dependency's source or type definitions in the worktree, at the version the lockfile pins. Never confirm or reject one from memory; say which file you opened.
7. **A performance-lane cost claim** needs a realistic size or a named hot path. Without one, score it 59 at most so it stays a question.
8. **Is the fix right?** If the proposed fix is wrong or worse, correct it in your answer. A ```` ```suggestion ```` fix replaces exactly the anchored lines, so widen the anchor when it replaces more.
9. **Rewrite the failure sentence** so a reader who never saw the analysis understands it: inputs or state, then the wrong outcome, in one sentence.

Score 0–100 on whether the defect is real, reachable, and matters, wherever it came from:

- **0–20** Not a real issue, unreachable, or a matter of taste with no rule behind it.
- **21–39** Might be real; could not verify; or a nit a senior engineer would not raise in this PR.
- **40–59** Real but unconfirmed in practice, or rare, or minor next to the rest of the PR. Becomes a question for the author.
- **60–74** Real and reachable, moderate impact, but not shown to happen. Becomes a question for the author.
- **75–89** Verified real, reachable in normal operation, will matter. A finding.
- **90–100** Verified real, the evidence directly shows the wrong outcome (a failing spec you ran, a query result, a trace). A finding, and say what you ran.

Return exactly:

```
score: <0-100>
verdict: confirmed (75 and up) | plausible (40–74) | rejected (below 40)
source: <lane slug> | case-against | bot:<login>
anchor: <path>:<line> · as filed | re-anchored
introduced: yes | made-worse | pre-existing
failure: <rewritten one-sentence failure scenario>
severity: blocker | fix-before-merge | nit | question
fix: <confirmed or corrected fix>
checked: <what you read and ran, file:line and commands>
```

`verdict` follows from `score` and never disagrees with it. A `gate` finding (the repo's own build, lint, or test failing on this PR's lines) never comes to a verifier: the tool's output is the evidence.

Rules: never rescue a finding by inventing a second scenario the original did not claim. Reviewers fill space: when a lane's findings are all style, score them as style; volume never raises a score, and "I would have done it differently" without a concrete failure is taste (0–20). Never raise the score because the finding sounds important. Never lower it because the author seems competent. A zero from a grep you did not confirm matches the code is not evidence. On a protected subject (authorization, data loss or corruption, concurrency, a behavior or compatibility change) a score below 40 must be backed by the exact code or command in `checked:` that disproves the claim; without it, score 40 so the finding survives as a question.
