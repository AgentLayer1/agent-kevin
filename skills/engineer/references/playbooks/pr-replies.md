# PR replies

**You own the answer to every review thread on the operator's own PR:** each comment judged against the current code, the accurate ones fixed in the branch (uncommitted), the wrong ones answered with receipts, and a paste-ready reply for every thread in PR scroll order. Start with the [PR foundation](../pr/foundation.md); this playbook replaces the review fan-out with a thread-driven pass plus a bounded self-pass.

Every response begins with `↩️ PR replies (read-only against GitHub · fixes land uncommitted in the branch)`.

## Steps

1. **Foundation Steps 0–3,** with the operator's branch checked out (`setup_worktree({ repoPath, branch: "<headRefName>" })`, or the worktree `list_worktrees` already shows).
2. **Pull the threads.** `github_pr_comments` → `reviewThreads` (inline), `reviews` (submission bodies), `comments` (conversation). If any `pageInfo.hasNextPage` is true, say the read was partial in the report.
3. **Classify each inline thread.** `isResolved` → needs nothing but a Resolve click if the last comment is the operator's, otherwise skip. Unresolved and the last comment is not theirs → needs a reply. Unresolved, `isOutdated` → still needs a reply; the anchor moved, so re-find the code by the reviewer's quoted snippet (`diffHunk`), never by the stale line number. Bot authors (Cursor Bugbot, CodeRabbit, Copilot, `*[bot]`) get the same treatment and a `bot` tag; a bot's confidence is not evidence. Bots file real catches and noise in one list, so judge each on the code, but a bot claim about security, privacy, auth, billing, migrations, idempotency, or concurrency is never dismissed on a reading alone: disprove it with a run or put it to the operator. A claim that a test no longer matches the code costs one command, so run that test on the head before judging it.
4. **Judge every comment against the head code, not the snapshot it was written on.** Verdicts: `accurate` · `partially` · `inaccurate` · `question` (not a defect, an ask for explanation) · `preference` (valid either way; decide, do not litigate). Judging means reading the callers, running the spec, or querying the database when the claim is about data; a claim you cannot settle by reading goes through [verify-rubric](../pr/verify-rubric.md) like any finding. One thing overrides a reviewer, and the reply says so plainly with receipts: a suggestion that contradicts an invariant documented in `knowledge/concepts/`.
5. **Fix what is accurate, in the worktree, uncommitted,** with [bug fix](bug-fix.md) discipline sized to the defect: reproduce it when it is behavior (a failing spec before the fix when the repo's test policy wants one), fix at the cause ([fix root causes](../principles/fix-root-causes.md)), grep for the same pattern elsewhere in the PR. A reviewer's fix inside files the PR already touches goes into this branch even when the defect predates it. A fix that needs files the PR does not touch, or its own measurement, becomes a follow-up line instead. Rebuild and rerun the affected specs after fixing, and state each fix's level on the [proof ladder](../principles/prove-it-works.md).
6. **Self-pass.** Run the correctness, invariants/authorization, and regression lanes from [dimensions](../pr/dimensions.md) over the operator's own diff (skipped under `--quick`), verified the way [pr review](pr-review.md) verifies. Anything that survives lands under **Found on my own** with the same fix discipline. Finding your own defect before the reviewer does is the point.
7. **Comment pass.** Run the [comment pass](../comment-pass.md) over the fix diff before anything is presented. Never `git add`, never commit, never push: leave `git status` as the reviewable set, and write one suggested commit message per group of related fixes, per [handoff](../handoff.md).
8. **Write replies for every thread that needs one, in PR scroll order** (file order as GitHub shows them, then line), so the report scrolls beside the Conversation tab. Use [the replies template](../../templates/replies.md) and [comment style](../pr/comment-style.md) → "Replies on your own PR". Each entry: a heading that states the reviewer's point in about five words and ends with a permalink to that comment (its own `url`, link text being the comment id), one plain line quoting the reviewer, then the reply as a blockquote, in the operator's voice. The verdict shows in how the reply opens, so it is not written out separately. Threads that only need Resolve go in one table at the end.
9. **Save** (foundation → Saving the report). A re-run lists which threads are new, which are answered since, and replaces the prior replies report; do not leave four overlapping drafts.

   ```
   report_write({
     category: 'reviews',
     slug: 'pr-<n>-replies',
     title: 'PR #<n> replies: <k> threads, <what every claim was checked against>',
     skill: 'engineer',
     status: 'findings' | 'clean' | 'draft',
     body: <the report, no frontmatter>,
     tags: ['pr-<n>', '<domain>', 'replies', ...],
     extra: { pr: <n>, author: '<login>', head: '<sha>', base: '<branch>', mode: 'reply',
              supersedes: '<relPath of the prior replies report or null>' }
   });
   ```

No teardown: the worktree is the operator's own branch, where they keep working after the replies go out.

**Reply:** in chat, after the report is saved: the banner, one line on the threads (answered, fixed, pushed back, resolve-only), the fixes left uncommitted with their suggested commit messages, the checks that did not run, and the report path. Nothing else.
