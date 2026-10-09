# PR replies

**You own the answer to every review thread on the operator's own PR:** each comment judged against the current code, the accurate ones fixed in the branch (uncommitted), the wrong ones answered with receipts, and a paste-ready reply for every thread in PR scroll order. Start with the [PR foundation](../pr/foundation.md); this playbook replaces the review fan-out with a thread-driven pass plus a bounded self-pass.

Every response begins with `↩️ PR replies (read-only against GitHub · fixes land uncommitted in the branch)`.

## Steps

1. **Foundation Steps 0–3,** with the operator's branch checked out (`setup_worktree({ repoPath, branch: "<headRefName>" })`, or the worktree `list_worktrees` already shows). Under `--quick` there is no worktree: replies are drafted from the diff, nothing is fixed, and the report is a `draft`.
2. **Pull the threads.** `github_pr_comments` → `reviewThreads` (inline), `reviews` (submission bodies), `comments` (conversation). If any `pageInfo.hasNextPage` is true, the read was partial: record it as a `Threads read` check with result `partial`.
3. **Classify each inline thread.** Resolved → skip it. Unresolved with the operator's comment last → **Just needs Resolve** when the head code still matches what they said, or `follow-up` when it no longer does (comment style → "Your own earlier answer was wrong"). Unresolved with someone else's comment last → needs a reply. An outdated thread (`isOutdated`) is classified the same way, but its anchor moved, so re-find the code by the reviewer's quoted snippet (`diffHunk`), never by the stale line number. Bot authors (the review bots foundation Step 1 lists) get the same treatment and a `bot` tag; a bot's confidence is not evidence. Bots file real catches and noise in one list, so judge each on the code, but a bot claim about security, privacy, auth, billing, migrations, idempotency, or concurrency is never dismissed on a reading alone: disprove it with a run or put it to the operator. A claim that a test no longer matches the code costs one command, so run that test on the head before judging it.
4. **Judge every comment against the head code, not the snapshot it was written on.** Verdicts: `accurate` · `partially` · `inaccurate` · `question` (not a defect, an ask for explanation) · `preference` (valid either way; decide, do not litigate). Judging means reading the callers, running the spec, or querying the database when the claim is about data; a claim you cannot settle by reading goes through [verify-rubric](../pr/verify-rubric.md) like any finding. One thing overrides a reviewer, and the reply says so plainly with receipts: a suggestion that contradicts an invariant documented in `knowledge/concepts/`.
5. **Fix what is accurate, in the worktree, uncommitted** (never under `--quick`), with [bug fix](bug-fix.md) discipline sized to the defect: reproduce it when it is behavior (a failing spec before the fix when the repo's test policy wants one), fix at the cause ([fix root causes](../principles/fix-root-causes.md)), grep for the same pattern elsewhere in the PR. A reviewer's fix inside files the PR already touches goes into this branch even when the defect predates it. A fix that needs files the PR does not touch, or its own measurement, becomes a follow-up line instead. Rebuild and rerun the affected specs after fixing, and state each fix's level on the [proof ladder](../principles/prove-it-works.md).
6. **Self-pass.** Run the `correctness`, `invariants`, and `regressions` lanes from [dimensions](../pr/dimensions.md) over the operator's own diff (skipped under `--quick`), verified the way [pr review](pr-review.md) verifies. Anything that survives lands under **Found on my own** with the same fix discipline. Finding your own defect before the reviewer does is the point.
7. **Comment pass.** Run the [comment pass](../comment-pass.md) over the fix diff before anything is presented. Never `git add`, never commit, never push: leave `git status` as the reviewable set, and write one suggested commit message per group of related fixes, per [handoff](../handoff.md).
8. **Write a reply for every thread that needs one,** in the operator's voice per [comment style](../pr/comment-style.md) → "Replies on your own PR" (read it first), and in the order, fields, and statuses [PR report](../pr/report.md) → Replies sets. The verdict shows in how each reply opens, so it is not written out separately.
9. **Save** as [PR report](../pr/report.md) describes: the replies data, then the card and the page rendered from it. A re-run lists in `sinceLast` which threads are new and which were answered since, and supersedes the prior replies report (the old file stays; `supersedes` names it); do not leave four overlapping drafts. Save the card with the arguments `pr-report.ts card` printed (`body`, `summary`, `status`, `extra`), plus:

   ```
   report_write({
     ...<the arguments card printed>,
     category: 'reviews',
     slug: 'pr-<n>-replies',
     title: 'PR #<n> replies: <k> threads, <what every claim was checked against>',
     skill: 'engineer',
     tags: ['pr-<n>', '<domain>', 'replies', ...],
     extra: { ...<extra card printed>, supersedes: '<relPath of the prior replies report or null>' }
   });
   ```

   Then write the page beside it (PR report → step 5).

No teardown: the worktree is the operator's own branch, where they keep working after the replies go out.

**Reply:** in chat, after the report is saved: the banner, one line on the threads (answered, fixed, pushed back, resolve-only), the fixes left uncommitted with their suggested commit messages, the checks that did not run, and the page path. Nothing else.
