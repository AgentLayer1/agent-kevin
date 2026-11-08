# Interrogate

The [pr review](playbooks/pr-review.md)'s analysis on a branch that has no PR yet, so the operator opens one that is already clean. The lanes, gates and verifiers are the review's own, called by reference rather than copied; everything tied to GitHub or the report page is dropped. Verified defects are fixed in the working tree and left uncommitted, and the hand-off is a reply in chat. Use it for "interrogate this branch", "tear this apart", "get this ready for a PR", or a contested design before shipping. For model diversity, which is where the adversarial signal really comes from, follow it with a cross-model round from the adversarial-review skill.

Every response begins with `🔎 Interrogate (pre-PR · <branch> vs <base> · fixes uncommitted)`.

## Reading the PR steps here

The steps below call the PR playbooks, which assume a PR. Read them with these substitutions:

- **The head** is the working tree on disk, uncommitted edits included. A lane's `code:` lines are copied from the file as it is now; `git blame` showing "Not Committed Yet" means `introduced: yes`.
- **The worktree** is the operator's checkout, in place: no `setup_worktree`, no teardown.
- **The PR number** becomes the branch and base. There is no thread list, PR body, CI run, or `github_pr_*` call.
- **The report** is not written, so anything a step drafts only for the page is skipped (the How it works data, the description check, the `architecture` data).

## Steps

1. **Scope.** By default the current branch: `git diff <base>...HEAD` plus the uncommitted working tree. `<base>` is the base the operator names, else `git symbolic-ref --short refs/remotes/origin/HEAD`; when that is unset, ask. Files the operator names narrow the scope to those files. When the branch already has an open PR (`github_pr_list`, match `headRefName`), say so in one line, offer `/engineer review <n>`, and carry on.
2. **State the intent** in one paragraph from the request, the task, the commit messages and the code. If you're unsure of it, ask before spawning.
3. **Prior context and understanding.** [Foundation](pr/foundation.md) Step 1 items 1–4 (prior reports, tasks, concepts, the repo's conventions). Then foundation Step 2 from "Build the model" on, against the local diff: what, why, how and blast radius, the coverage checklist, the triage, and asked versus delivered against the task.
4. **Gates.** Foundation Step 3 item 1, each gate in a subshell on the repo. When simplify ran them on this same tree earlier in the run, reuse its results.
5. **Fan-out.** [pr review](playbooks/pr-review.md) Step 2 as written: compact or full sizing, the architecture trigger, the lanes in [dimensions](pr/dimensions.md), the `pr/langs/` addenda, the case against, and the finding shape without `raised` and `pr`. The hygiene lane has no body to check, so its "body versus diff" item returns the claims the description must make instead; its other items stand. The architecture lane returns its recommendation as prose: the target shape and the ordered steps toward it.
6. **Verify** every candidate with pr review Step 3 and [verify-rubric](pr/verify-rubric.md), against `<base>`.
7. **Sort and judge.** pr review Step 4's thresholds, dedupe, ranking and gate rule (its verdict and thread states don't apply). Then judge as the lead, not an aggregator. You have the context the reviewers lacked:
   - **Nitpick gravity:** reviewers fill space, so a run that's all nits means the code is probably fine.
   - **Hypothetical versus actual:** "what if this is null" counts only if a caller can pass null. Trace it.
   - **Premature abstraction:** a suggested extraction with one caller isn't a finding.
   - **Preference:** "I'd have done it differently" without a concrete cost is dismissed.
   - **Missing context:** a pattern consistent with the rest of the codebase.
   - Be slow to dismiss correctness and security findings, even from one lane.

   What survives lands in four buckets: **Act on** (score ≥ 75, `blocker` or `fix-before-merge`, introduced or made worse by this branch), **Consider** (40–74 as questions, nits worth acting on, and the architecture recommendation), **Noted** (`pre-existing`), and **Dismissed** (< 40, one line each with the reason, so the operator can overrule you).
8. **Fix the Act-on items** in the working tree, uncommitted, with [pr replies](playbooks/pr-replies.md) step 5's discipline: reproduce a behavior defect first, fix at the cause, grep for the same pattern across the branch. Rerun the gates the fixes touch, state each fix's level on the [proof ladder](principles/prove-it-works.md), then run the [comment pass](comment-pass.md). A fix that changes intended behavior or reaches outside the branch's files is held as Consider instead.

## After simplify

"Simplify and interrogate this branch" runs [simplify](playbooks/simplify.md) on the branch first, then this playbook on the result, so the review judges the cleaned code. The gates run once, and the reply lists what simplify changed above the buckets.

## Reply

In chat; no report is written. The banner, then:

- **Readiness**, one line, judged after the fixes: `ready for a PR`, `ready once you decide <X>`, or `not ready: <blocker>`.
- **Gates**, one row each: the command and its result, or `not run (<reason>)`.
- **Act on**, each as fixed: `file:line`, the failure in one sentence, the fix, its proof level, and the lanes that raised it (two or more is the strongest signal).
- **Consider**, **Noted**, **Dismissed**, one line each.
- **The case against**: its three answers as written.
- **Coverage**: files reviewed and skipped, with the skip reasons.
- **Next**: suggested commit messages for the fixes, and a draft PR title and description per [handoff](handoff.md), built on the hygiene lane's claims. Opening the PR is a separate ask.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `interrogate` skill and its rubric, code-quality, and lead-judgment references (MIT, Copyright (c) 2026 Lauren Tan).
