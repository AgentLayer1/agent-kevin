---
name: adversarial-review
description: >
  Cross-model adversarial review of your own work, as a loop on one dossier in
  `<HOME>/reports/reviews/`: a PR, a branch, an uncommitted working tree, or a plan, spec, skill,
  or document. `brief` writes a self-contained prompt (stakes, the exact paths and ranges, bug
  classes already seen, numbered claims to falsify, an output contract) and hands back the one
  line a second model needs to append its findings to that same file. `verify` checks every
  finding against the work, fixes the real ones (committed on your branch for code, in place for
  a working tree or a document), records the disposition and ledger in the same file, refreshes
  the brief, and hands back the next round's prompt. The reviewing model documents; the
  implementing one codes. Triggers on /adversarial-review, "get a second model to review this
  branch / plan / doc", "have another model check my work", "the other model's pass is done,
  verify and fix".
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Bash
  - Agent
  - AskUserQuestion
  - mcp__plugin_agent-kevin_kevin__github_pr_view
  - mcp__plugin_agent-kevin_kevin__github_pr_diff
  - mcp__plugin_agent-kevin_kevin__github_pr_list
  - mcp__plugin_agent-kevin_kevin__github_issue_view
  - mcp__plugin_agent-kevin_kevin__github_fast_forward
  - mcp__plugin_agent-kevin_kevin__setup_worktree
  - mcp__plugin_agent-kevin_kevin__list_worktrees
  - mcp__plugin_agent-kevin_kevin__task_get
  - mcp__plugin_agent-kevin_kevin__task_thread
  - mcp__plugin_agent-kevin_kevin__report_write
---

# Adversarial Review

> **Paths.** The absolute repo path is `${KEVIN_CODE_PATH:-$AGENT_CODE_PATH}` (AGENTS.md → "Where Your Code Lives") unless the operator names one or more repos or artifacts. Prefix it on every Read/Grep/Bash call. `<HOME>` is the directory the agent was launched from, never the code repo.

A second model reading your work cold finds what the model that wrote it cannot: the assumptions baked into the commit messages, the plan, or the prose. But a second model's edits are not yet something the operator ships, so this skill splits the work by trust. The **reviewer** documents: it reads the brief, hunts, and writes findings. The **implementer** verifies each finding against the work, fixes what is real, commits where the target is committed code, and records what it did. Both are this same agent, launched from the same home on different models or hosts, so the dossier names the two sides by role and never by agent or model; the reviewer states which model and host it ran on at the top of its findings. Both write into one file, the dossier, round after round, so the conversation never scatters across reports and a settled finding is never raised twice.

It is for the operator's own work: a PR, a branch, an uncommitted working tree, or a plan, spec, skill, or document. A teammate's PR is `pr-review`'s job. Nothing here is posted anywhere; the operator carries the file between sessions.

## Banner

Every response begins with:

`⚔️ Adversarial review (<brief · verify> · round <n> · <pr · range · working-tree · paths> · <dossier relPath, or "new dossier">)`

Append `· --no-commit` / `· --refresh` when a flag changed what ran.

## Stance

- **The brief is a prompt, not a summary.** It is read by a model with none of this session's context. Everything it needs is in the file: the stakes, the exact paths and ranges, the bug classes already seen, and what a counterexample looks like. Write it so the reviewer can start without opening anything else in `<HOME>`.
- **Every stated intent is a claim to falsify.** Commit messages assert "equivalent", "preserves ordering", "no early return precedes it"; a plan asserts what the code will do; a skill or document asserts that every instruction, path, tool name, and number in it is right. List them. The reviewer's job is to break them; the brief's job is to name them.
- **Every fix is a new claim.** A fix landed under review pressure is as suspect as the original change. On every round after the first, the fixes since the last round get their own range in the brief and their own claims.
- **Findings are verified here, never trusted.** The reviewer's confidence is not evidence. Every finding goes through the same rubric `pr-review` uses, and the disposition records what was read or run, not what was believed.
- **The file is the state.** The status line, the frontmatter `round`, the Ledger, and the newest section heading say where the loop is. Read them before acting; keep them agreeing after.

## Step 0 — Resolve the target, the dossier, and the verb

**Target.** Parse the argument into one kind:

| Form | Kind | Resolves to |
|---|---|---|
| a PR number or URL | `pr` | `github_pr_view` → repo, `baseRefName`, `headRefName`; the head must be checked out locally (`list_worktrees`, else `setup_worktree` on the branch), because the reviewer reads local paths. `--repo owner/name` overrides the GitHub repo derived from the code path |
| `<repo-path>[:<base>..<head>]`, repeated | `range` | one row per repo; `<base>` defaults to the repo's default branch, `<head>` to the branch's HEAD. This is the multi-repo, unpushed case |
| `--working-tree [<repo-path>[:<base>]]` | `working-tree` | the repo's uncommitted work: tracked changes as `git diff <base>` plus every untracked path named in full (`git -C <repo> status --porcelain`), with `<base>` defaulting to HEAD. The head is recorded as `<sha> + working tree` |
| one or more file or directory paths that are not a git range | `paths` | the artifact itself, whole: a plan or spec under `reports/plans/`, a skill's `SKILL.md`, a roadmap, a doc. Each path is listed with its line count and, when git tracks it, the short SHA of its last commit; otherwise its mtime |
| nothing | `range` | the current branch of the code path against its default branch |

For `pr`, `range`, and `working-tree`, record per repo: absolute path, base ref, head SHA (`git -C <repo> rev-parse HEAD`), that the base is an ancestor of the head (`git -C <repo> merge-base --is-ancestor <base> <head>`; a failure means the range is wrong, stop), and whether the working tree is clean (`git -C <repo> status --porcelain`). A dirty tree on a `pr` or `range` brief is a question, not a silent choice: say which files and ask whether to commit them first or run the target as `working-tree`. For `paths`, record each path, its line count, and its SHA or mtime; a directory expands to the files under it, listed.

**Dossier.** `--doc <path>` names it. Otherwise `Grep <HOME>/reports/reviews/` for `tags: [adversarial` and match on the branch name, the PR number, or the repo or artifact paths in the frontmatter `repos` / `paths`. One match is the dossier; none means a new one; several means ask.

**Verb.** Explicit `brief` or `verify` wins. Otherwise: no dossier → `brief`. A dossier whose newest `## Round <n> — Findings` has no `## Round <n> — Disposition` below it → `verify`; when every Findings section of that round is still empty, the reviewer has not written yet, so say so and stop. A dossier whose newest round is dispositioned → `brief --refresh` (re-cut the brief at the current heads without a new round). Flags:

| Flag | Effect |
|---|---|
| `--reviewers <n>` | Run the round with `n` reviewers in parallel: the brief gets one lettered Findings heading per slot (`Reviewer A`, `Reviewer B`, …), each with its own handoff line, and ids read `R<n>A-<k>`. Default 1 |
| `--working-tree` | Review the uncommitted work of a repo (the `working-tree` kind above). Implies `--no-commit` |
| `--no-commit` | `verify` leaves fixes uncommitted; the refreshed brief points at the working tree. Implied for `working-tree` and `paths` |
| `--refresh` | `brief` on an existing dossier: rewrite the Brief and status line only |
| `--repo owner/name` | Override the GitHub repo derived from the code path when the target is a PR number |

While a round is out, the target stays where the brief points. Work that cannot wait lands on top and the next disposition records the drift; a reviewer judging a moving head produces findings nobody can anchor.

## Step 1 — Prior context (both verbs)

1. `Grep <HOME>/reports/reviews/` for the branch, the PR number, each repo's basename, and each artifact's basename. Prior `pr-review` or `pr-walkthrough` reports on the same change feed the brief's claims and are linked from the dossier, never copied.
2. `Grep <HOME>/projects/*/tasks/` for the branch, the PR, or the artifact; `task_get` the match. The task's intent is what the work is supposed to serve, and its thread gets one `task_thread` line per round.
3. For a code target, read each repo's own `AGENTS.md` (and `.claude/CLAUDE.md` beside it): the build and test loop the disposition must run, and the conventions a finding may cite. For a `paths` target, read what consumes the artifact: the tools and scripts a skill names, the code a plan is written against, the template a document was cut from.
4. `Grep <HOME>/knowledge/concepts/` for the domains the target touches. Concept articles inform the brief's "Why this matters" and the verifier's judgment; they are paraphrased into code terms, never quoted into the brief.

## `brief`

1. **Understand the work per target.** For `pr` and `range`: `git -C <repo> log --format='%h %s%n%b' <base>..<head>` for the messages, `git -C <repo> diff --stat <base>...<head>` for the shape, then the diff itself, read for what changed grouped by concern. For `working-tree`: `git -C <repo> diff <base> --stat`, the diff, and every untracked file in full. For `paths`: every file in full. Pull every assertion out of whatever states the intent into a working list: commit messages for `pr` and `range`; the task thread, the plan or spec the change implements, and the operator's own description for `working-tree`; the artifact's own assertions for `paths` (every "always", "never", "must", every path, tool name, parameter, flag, and number it names). Each becomes a numbered claim with what would falsify it. Add claims for anything the work does that its stated intent does not mention.
2. **Name the bug classes.** What already bit this work (a crash found in testing, a finding from a prior round or a prior `pr-review`, an instruction a model failed to follow), described so the reviewer can hunt the remaining instances: the shape, why it compiles, passes tests, or reads fine, where the rest would hide.
3. **Write the dossier** from `templates/dossier.md`. On a new dossier every section is present, the round-1 Findings heading is empty (one per slot under `--reviewers`), and the Ledger is empty (or seeded from prior reports, one row per finding they raised, linking the report). The template's Stance carries a code paragraph and a prose paragraph; keep the one that applies to the target. On `--refresh`, rewrite only the Brief and the status line.
4. **Save.** New dossier:

   ```
   report_write({
     category: 'reviews',
     slug: 'adversarial-<short-topic>',          // 'adversarial-pr-<n>' for a PR
     title: '<Work title>: adversarial review dossier',
     skill: 'adversarial-review',
     status: 'draft',
     body: <the dossier, no frontmatter>,
     tags: ['adversarial', '<branch, pr-<n>, working-tree, or artifact basename>', '<domain>', ...],
     extra: { round: 1, kind: '<pr · range · working-tree · paths>', task: '<id or null>',
              repos: [{ name, path, base, head }, ...],     // code kinds
              paths: [{ path, lines, sha }, ...] }          // paths kind
   });
   ```

   Existing dossier: `Edit` in place. Never a second file for the same target.
5. **Hand back.** The banner, the dossier path, the claims count, and the handoff in one fenced block per reviewer slot so `/copy` lifts it:

   ```
   Read <absolute dossier path> and do what "Brief for the reviewer" says. Write your findings into that same file under the empty heading "## Round <n> — Findings (Reviewer)". Change nothing else in it and nothing in the repositories or the files under review. When you are done, reply with only the path of the file.
   ```

   One line after it: the reviewer session is launched from `<HOME>` so the file is writable, and the repositories or artifacts must be readable from it. Under `--reviewers`, each block names its own slot heading.

## `verify`

1. **Read the newest round.** Parse every `### R<n>…-<k>` block under every `## Round <n> — Findings` heading of the round (one per slot). Note the model and host each reviewer names and the heads (or SHAs and mtimes) it says it read; when they differ from the current ones, say so in the disposition and judge against the current work anyway. A slot still empty after its reviewer reported done means that reviewer's write was lost: ask it to re-append, never reconstruct findings from chat.
2. **Verify each finding.** A fresh `Agent` (subagent type `general-purpose`) per batch of related findings, all batches launched in one message so they run in parallel, each given `../pr-review/references/verify-rubric.md` verbatim, the finding block, the repo or artifact path, and the base ref (the rubric's `origin/<base>` reads as the dossier's base for a local branch, and as the base SHA for a working tree). Verifiers are independent of the reviewer's text: they re-anchor by the `code:` snippet, blame the line, trace the failure from an entry point, and score 0–100. For a `paths` target the rubric maps as follows, and the verifier is told so: step 1 anchors by the quoted lines; step 2 asks whether the line is inside the file under review; step 3 asks whether a reader (or the model that executes a skill) following the text as written reaches the wrong outcome, and names the sentence that sends them there; step 5 (linter, type checker) is skipped; the scale and the protected-subject floor stay. Protected subjects (authorization, data loss, concurrency, behavior changes; for prose, an instruction that deletes, sends, or spends) never drop below a question without the exact code, command, or sentence that disproves them. Two reviewers reporting the same defect verify once and become one Ledger row citing both ids.
3. **Act on the verdicts.**
   - **Confirmed (≥ 75):** fix in the smallest correct change. For `pr` and `range`, on the operator's branch: run the repo's own loop from its `AGENTS.md` (build and the affected tests; the whole suite when the fix touches shared code), then commit, one commit per group of related fixes, with the finding ids in the message body. Never push. Under `--no-commit`, leave the tree dirty and write one suggested commit message per group in the disposition. For `working-tree`, fix in the tree, run the same loop, and write the suggested commit message per group; the operator commits. For `paths`, edit the artifact in place; commit only when it lives in a code repo whose tree was clean at the brief, otherwise say the edits are uncommitted (an artifact inside `<HOME>` is left to the home's own commit cadence).
   - **Plausible (40–74):** no change. An `open` Ledger row with what would settle it, and a claim in the refreshed brief asking the reviewer to settle it.
   - **Rejected (< 40):** one line with the receipt: the file and line read, the command run, the output.
   - **Pre-existing:** `inherited`. One line on why it is not this work's problem and where it is tracked; when a task is linked, `task_thread` it there as an `[!info]` entry. A pre-existing defect the work makes worse or newly reachable is confirmed, not inherited.
4. **Write `## Round <n> — Disposition (Implementer)`** in the template's shape: one sentence on the round's accuracy and the real catch, the verdict table, the build and test results per repo after the fixes (`–` for a `paths` target with nothing to run), and what was not done this round. A reviewer claim that was wrong is corrected here, never by editing the Findings section.
5. **Update the Ledger.** One row per finding of this round; earlier rows change state only when this round settled them.
6. **Refresh the Brief.** New heads (or SHAs and mtimes) in the status line and the What-to-review table; a "fixes since round <n>" range per repo or artifact that changed; settled claims removed (a claim the reviewer marked `holds` retires only when the work it names has not changed since; otherwise it stays); every fix added as a claim with what would falsify it; the bug-classes paragraph extended with anything this round taught. Numbering continues from the last claim. Then append the empty `## Round <n+1> — Findings (Reviewer)` heading (one per slot) at the end of the file, so the next handoff line points at a heading that exists.
7. **Frontmatter and index.** `round: <n+1>`, `heads` per repo or `paths` per artifact, `status: findings` while anything is open or `clean` when the Ledger has no open rows, `verdict: <one clause>`. Update the dossier's line in `<HOME>/reports/index.md` to the same status marker (⏳ draft · 🟠 findings · 🟢 clean). The status line, the frontmatter, the index line, and the newest heading must agree.
8. **Hand back.** The banner, the round's verdict in one line, the fixes with their commits (or the suggested commit messages), what was rejected and why in one line each, what did not run, and the round `<n+1>` handoff block from `brief` step 5. Nothing else; do not repeat the disposition.

## Closing the loop

When a round returns no confirmed findings and the Ledger has no open rows, say so and recommend closing. On the operator's word, set the status line to `closed`, `status: clean` in the frontmatter, and append one line to the linked task's thread. The dossier stays where it is; it is the record of what was checked and by whom.

## Boundaries

- Never posts to GitHub or any chat surface. Never pushes. Never tags.
- Never edits a teammate's branch; the target is the operator's own work.
- The reviewer never modifies the repositories or the files under review; the Output contract says so, and a round whose heads moved without an implementer commit is flagged in the disposition.
- The brief leaves the machine to another vendor. It carries code facts and task intent only: nothing from `<HOME>` memory, feedback, or private notes, no operator-personal detail, and placeholders where the repo's conventions require them (`acme`, never a client name). An artifact under `<HOME>` is reviewed for what it says, and the brief quotes only the artifact.
- Fixes stay in the smallest correct change. A finding whose fix is a design change becomes an `open` Ledger row and a task note, not a rewrite under review pressure.
- Parallel reviewers share one file with no lock. Each writes only its own slot section and re-reads the file right before writing; the contract says so. A lost section is re-appended by the reviewer that wrote it, never rebuilt from its chat.
