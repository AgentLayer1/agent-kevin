# PR review

**You own a verified verdict on a teammate's PR** and the words to deliver it: the change explained well enough to discuss with its author, every defect proven against the code, and paste-ready comments anchored to `file:line`. Start with the [PR foundation](../pr/foundation.md); this playbook adds the hunt.

Every response begins with `🔍 PR review (read-only against GitHub · local worktree build)`.

## Stance

The foundation's stance holds, plus:

- **Unchanged code is not a regression.** Before calling something broken, `git blame` it. A months-old block is almost always intentional design you do not yet understand. Findings are scoped to what this PR introduced; pre-existing defects that the PR makes worse or newly reachable count, anything else is a one-line aside at most.
- **A finding is a failure scenario, not an opinion.** Every finding names concrete inputs or state and the wrong outcome. If you cannot write that sentence, it is a question for the author, not a finding.
- **The principles are the bar, not taste.** A structural finding cites the principle or repo rule it applies, by name, so the author can read the rule rather than argue with the reviewer.

## Steps

1. **Foundation Steps 0–3.** Resolve the target (a teammate's PR, or the operator's own under an explicit `/engineer review`), prior context, understand the change and write the **How it works** section, then local verification on a throwaway `pr-<n>-review` worktree.
2. **Adversarial fan-out.** Launch the lanes in [dimensions](../pr/dimensions.md) as parallel `Agent` calls (subagent type `general-purpose`), one lane per agent, all in a single message. Each prompt carries: the PR number and repo, the worktree path, the head SHA, the diff (or the file list when the diff is large), the relevant concept articles' paths, the repo conventions path, the coverage checklist, the lane's checklist verbatim, the absolute paths of the principle and playbook files the lane names (the agent reads them before judging), and any addendum under `../pr/langs/` whose language appears in the changed files ([swift](../pr/langs/swift.md) for `.swift`). Each agent returns findings in this exact shape, one per finding, then one coverage line per checklist file, nothing else:

   ```
   file: <repo-relative path>
   line: <line on the head commit>
   code: <the anchored line or lines, verbatim from the head commit>
   lane: <lane name>
   severity: blocker | fix-before-merge | nit | question
   claim: <one sentence, the defect>
   failure: <concrete inputs/state → wrong outcome>
   evidence: <what you read or ran: file:line, command, output>
   principle: <the principle or repo rule applied, or none>
   fix: <the change, as a diff or one sentence>
   introduced: yes | made-worse | pre-existing
   ```

   ```
   coverage: <path> reviewed | skipped (<reason>)
   ```

   The `code:` lines are the anchor of record; `line:` is where they sat when the lane looked. A finding whose snippet is not in the file is unverifiable, so copy it exactly. `--quick` replaces the fan-out with a single inline pass over the correctness, invariants/authorization, and PR-hygiene lanes.
3. **Verify every candidate.** Each goes to a fresh verifier `Agent` with [verify-rubric](../pr/verify-rubric.md) verbatim plus the finding and the worktree path. Batch related findings per verifier; keep verifiers independent of the lane that produced the finding. The verifier scores 0–100 and returns the corrected failure scenario.
4. **Sort, dedupe, rank.**
   - **≥ 75** → a finding. Severity stays as the lane set it unless the verifier's evidence moves it.
   - **40–74** → a **question for the author**, rephrased as a question with what would settle it.
   - **< 40** → dropped, and listed one line each (claim, why it failed) under the report's "Dropped after verification" so the operator can rescue one. Never a bare count.
   - **Protected subjects never drop silently.** A candidate about authorization, data loss or corruption, concurrency, or a behavior or compatibility change that scores below 40 becomes a question for the author unless the verifier's `checked:` line names the exact code or command that disproves it. A hunch is not a disproof; a wrongly dropped finding is lost for good, a wrongly kept one costs the operator a minute.
   - `introduced: pre-existing` with no made-worse argument → one line under "Noticed, not this PR's problem" at most, never a comment.
   - Merge duplicates across lanes into one finding that cites both lanes' evidence. Findings raised independently by two lanes are the strongest signal.
   - Rank: security/authz › data loss or corruption › a documented domain invariant › correctness › regression › tests › conventions. Within a rank, blast radius decides.
   - Nits that a linter would catch are not findings when the lint ran clean. When the lint failed, the lint output is **one** finding ("lint fails on the branch: N errors in M files, first three: …"), never one comment per line.
5. **Write the report** from [the review template](../../templates/review.md): fixed section order, fixed emoji legend, summary blockquote first, `---` between sections. Every paste block follows [comment style](../pr/comment-style.md); read it before writing the first comment. The report is what the operator reads beside the PR, not a transcript of the analysis. Save it (foundation → Saving the report):

   ```
   report_write({
     category: 'reviews',
     slug: 'pr-<n>-<short-topic>',
     title: '<PR #n (<author>): <verdict in one clause>>',
     skill: 'engineer',
     status: 'critical' | 'findings' | 'clean' | 'draft',
     body: <the report, no frontmatter>,
     tags: ['pr-<n>', '<author>', '<domain>', 'review', ...],
     extra: { pr: <n>, author: '<login>', head: '<sha>', base: '<branch>', mode: 'review',
              verdict: 'approve' | 'approve-with-fixes' | 'changes-requested' | 'do-not-merge',
              blockers: <count>, supersedes: '<relPath of the prior report or null>' }
   });
   ```

   `critical` when a blocker touches security, authorization, or data integrity; `findings` when anything must change; `clean` when the verdict is approve with nothing above nit; `draft` when `--quick` was used or local checks did not run.
6. **Tear down** the throwaway worktree (foundation → Teardown). A self-review on the operator's own branch never tears down.

**Reply:** in chat, after the report is saved: the banner, the verdict line, the top three items with anchors, the checks that did not run, the worktree line (`removed <path>` or `kept <path> (<reason>)`), and the report path. Nothing else. Do not repeat the report.
