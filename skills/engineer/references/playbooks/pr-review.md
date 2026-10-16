# PR review

**You own a verified verdict on a teammate's PR** and the words to deliver it: the change explained well enough to discuss with its author, every defect proven against the code, and paste-ready comments anchored to `file:line`. Start with the [PR foundation](../pr/foundation.md); this playbook adds the hunt.

Every response begins with `🔍 PR review (read-only against GitHub · local worktree build)`, with `· re-review of <date>` on a re-review, and `· --quick`, `· --no-local`, `· --full` or `· --fresh` appended when given.

## Stance

The foundation's stance holds, plus:

- **Unchanged code is not a regression.** Before calling something broken, `git blame` it. A months-old block is almost always intentional design you do not yet understand. Findings are scoped to what this PR introduced, made worse, or newly made reachable.
- **A finding is a failure scenario, not an opinion.** Every finding names concrete inputs or state and the wrong outcome. If you cannot write that sentence, it is a question for the author, not a finding.
- **The principles are the bar, not taste.** A structural finding cites the principle or repo rule it applies, by name, so the author can read the rule rather than argue with the reviewer.

## Re-review

A prior review of the same PR (foundation Step 1) makes this run a **re-review**, unless `--fresh` is given. The author has usually pushed fixes and replied, so a second full pass mostly re-reads what hasn't changed and buries the delta. Instead:

1. Diff `<prior head>..<head>` in the worktree (`git -C "<worktree>" log --oneline` and `diff --stat` over that range). A force-push that dropped the prior head means the diff can't be trusted: say so and run `--fresh`.
2. **Re-verify every prior finding and question at the new head**, one verifier per batch with [verify-rubric](../pr/verify-rubric.md): `fixed`, `changed` (the code moved, the problem moved with it), `open`, or `moot` (the code is gone). Each becomes a `sinceReview.findings` row with the anchor that proves it; a still-open one stays a finding with `priorId` set to its old id.
3. **Run the lanes on what changed since**, the files in that range plus their blast radius, and on the whole PR only for the case against. The coverage checklist is that file set; the rest is "reviewed in the <date> review" in the Coverage check.
4. **Re-read the conversation since the prior review's date**: new threads, the author's replies, and which of the operator's comments were posted and how they were answered. A reply that claims a fix is checked at the head, like any claim.
5. Re-check the description against the head (it often lags the fixes), and re-run the local gates in full: a fix can break what the first review saw pass.

The page opens with **Since last review**, and the summary leads with the delta. `--fresh` is for when the PR was rewritten, the prior review is untrustworthy, or the operator asks for it; it still reads the prior report and fills `sinceReview`, so the delta is never lost.

## Steps

1. **Foundation Steps 0–3.** Resolve the target (a teammate's PR, or the operator's own under an explicit `/engineer review`), prior context, check out the head (a throwaway `pr-<n>-review` worktree, or the operator's own branch for a self-review) and understand the change (the **How it works** draft), then the local gates.
2. **Adversarial fan-out.** Size it from the foundation's coverage checklist and triage first:
   - **Compact** when the PR changes fewer than 300 lines outside the files skipped up front and no file is triaged `risk`: three agents, each carrying three lanes (`correctness`, `regressions`, `tests` · `invariants`, `security`, `performance` · `conventions`, `generated-code`, `hygiene`).
   - **Full** otherwise, or with `--full`: one agent per lane. A small PR that touches a risk surface stays full, since that is where the depth pays.

   - **Architecture** joins either size when the PR adds a provider, an integration, or a module, adds a folder of eight or more files, or changes about 1,500+ production lines across more than one app: one more agent on the `architecture` lane. Its file-layout comparison (the new folder today beside an organized target) goes in every such review, even when the rest of the section is short. It reads the whole PR, not a file list, and returns the report's `architecture` data beside any findings.

   Launch the lanes in [dimensions](../pr/dimensions.md) as parallel `Agent` calls (subagent type `general-purpose`), all in a single message. Each prompt carries: the PR number and repo, the worktree path, the head SHA, the diff (or the file list when the diff is large), the relevant concept articles' paths, the repo conventions path, the coverage checklist, the thread list from foundation Step 1 (every open point, with its author and link, and the rule: a point already raised is returned with `raised: <link>`, not as a new finding), the checklist of each lane it carries verbatim, the absolute paths of the principle and playbook files the lane names (the agent reads them before judging), and every addendum under `../pr/langs/` whose language appears in the changed files ([swift](../pr/langs/swift.md) for `.swift`, [typescript](../pr/langs/typescript.md) for `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`). Each agent returns findings in this exact shape, one per finding, then one coverage line per checklist file, nothing else:

   ```
   file: <repo-relative path>
   line: <line on the head commit>
   code: <the anchored line or lines, verbatim from the head commit>
   lane: <the lane's slug from dimensions>
   severity: blocker | fix-before-merge | nit | question
   claim: <one sentence, the defect>
   failure: <concrete inputs/state → wrong outcome>
   evidence: <what you read or ran: file:line, command, output>
   principle: <the principle or repo rule applied, or none>
   fix: <the change, as a diff or one sentence>
   introduced: yes | made-worse | pre-existing
   raised: <the thread's link, when a reviewer already raised it, or none>
   ```

   ```
   coverage: <path> reviewed | skipped (<reason>)
   ```

   The `code:` lines are the anchor of record; `line:` is where they sat when the lane looked. A finding whose snippet is not in the file is unverifiable, so copy it exactly. `--quick` replaces the fan-out with a single inline pass over the `correctness`, `invariants`, `generated-code`, and `hygiene` lanes against the diff alone.

   In the same message (not under `--quick`), launch one more agent, **the case against**. It gets the same PR context and the How it works draft, and answers three questions in one or two sentences each: the strongest argument against merging this as it stands; the most likely way it causes a problem three months from now; and, if 40% of the diff had to go, what goes and why (the load-bearing remainder is what the human should read hardest). Any concrete defect it names comes back in the finding shape with `lane: case-against` and is verified like the rest; the three answers go to the report as written.
3. **Verify every candidate.** Each goes to a fresh verifier `Agent` with [verify-rubric](../pr/verify-rubric.md) verbatim plus the finding and the worktree path. Batch related findings per verifier, at most two verifiers on a compact run; keep verifiers independent of the agent that produced the finding. The verifier scores 0–100 and returns the corrected failure scenario. Under `--quick` the inline pass verifies against the diff and says so.

   Every thread from foundation Step 1 that makes a checkable claim goes through the same verifiers, people's and bots' alike. Turn each into the finding shape first, with `lane: bot:<login>` for a bot (a person's thread keeps the lane that matches its subject), the claim, and `code:` copied from the head commit at the thread's anchor. Before verifying, mark any whose anchored lines changed since the comment and no longer hold the defect as `fixed`, and any bot claim that only restates a lint or formatter rule as `outdated`. A thread that matches a lane finding merges into it: the finding keeps one id, credits both, and carries `raisedBy` with the thread's link, so its paste is a reply on that thread that adds only what's new. A bot claim about security, privacy, auth, money movement, compliance, migrations, idempotency or concurrency is never dismissed on a reading alone. A code comment or an author's reply describing partner behavior is a claim too: check the partner's docs before it decides anything.
4. **Sort, dedupe, rank.**
   - **≥ 75** → a finding. Severity stays as the lane set it unless the verifier's evidence moves it.
   - **40–74** → a **question for the author**, rephrased as a question with what would settle it.
   - **< 40** → dropped, and listed one line each (claim, why it failed) under the report's "Dropped after verification" so the operator can rescue one. Never a bare count. The rubric already holds a protected subject at 40 unless something disproves it, so nothing protected drops on a hunch.
   - A real defect with `introduced: pre-existing` and no made-worse argument → one line under "Noticed, not this PR's problem", never a comment.
   - Merge duplicates across lanes into one finding that cites both lanes' evidence and lists both in its `lanes`. Findings raised independently by two lanes are the strongest signal.
   - Rank: security/authz › data loss or corruption › a documented domain invariant › correctness › regression › performance › tests › conventions. A generated-code tell ranks by the failure it causes (an invented API call is correctness, a bent test is tests). Within a rank, blast radius decides.
   - Every thread ends with one state, per [PR report](../pr/report.md) → Review → **conversation**. The human should never have to triage a thread the review already read, and the author never sees the same point twice.
   - **Verdict**, the first that applies in this order. `do-not-merge` when a blocker is unfixable in this PR's shape; `changes-requested` when a blocker or fix-before-merge finding stands; `needs-discussion` when nothing is broken but merging should wait on a product or design call a human must make first (an asked-versus-delivered gap, a case-against trade-off, or a Decisions row the operator would plausibly reverse; most Decisions rows are context, not blockers, so name the one that decides it); `approve-with-fixes` when questions remain, or nits the author should act on; `approve` when there are no findings and no questions, at most a few optional nits.
   - When a linter or formatter failed on lines this PR introduced, its output is **one** finding with `lanes: [gate]` ("lint fails on the branch: N errors in M files, first three: …"), never one comment per line; failures already on the base go under "Noticed".
5. **Write the report** as [PR report](../pr/report.md) describes: the review's data, then the card and the page rendered from it. Write the `description.proposed` replacement last, once the findings settle, so it describes the code the author will merge and leaves the review's findings out. Read [comment style](../pr/comment-style.md) before writing the first comment. The page is what the operator reads beside the PR and pastes from, not a transcript of the analysis. The slug is `pr-<n>-<short-topic>`, the title `PR #<n> (<author>): <verdict in one clause>`, and the tags `['pr-<n>', '<author>', '<domain>', 'review', ...]`.
6. **Tear down** the throwaway worktree (foundation → Teardown). A self-review on the operator's own branch never tears down.

**Reply:** in chat, after the report is saved: the banner, the verdict line, the top three items with anchors, the checks that did not run, the worktree line (`removed <path>` or `kept <path> (<reason>)`), and the page path. Nothing else. Do not repeat the report.
