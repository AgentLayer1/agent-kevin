# Reviewing a plan

A plan is a `paths` target that describes work still to be done: anything under `<HOME>/reports/plans/` (plan-spec output and native plan-mode saves), or an artifact whose body is steps, phases, or changes to make. Its defects are rarely in the prose. They sit where the plan meets the code it will be carried out against: a file that is not where the plan says it is, a caller the plan never mentions, a phase that leaves the default branch broken, a check that cannot run. So a plan review reads the plan against that code, and a plan's design is still cheap to change, so design findings go to the operator instead of being parked.

Read this file whenever the target is a plan: in Step 0 to resolve the grounding, in `brief` to pull the claims, in `verify` to judge and act.

## Grounding

The grounding is the code the plan will change, handed to the reviewer and the verifiers read-only. It is context, not the target: nothing in it is a finding unless the plan is wrong about it.

1. **Resolve it.** In order: the plan's own grounding line ("Grounded against `<repo>` `<ref>` @ `<sha>`", repeated per repo or worktree); else every repo the plan names by absolute path, by basename under the code root, or through the files it cites; else the code path. A branch named without a path is found with `git -C <repo> worktree list`. Several candidates with nothing to pick between them is a question.
2. **Record it** per repo: absolute path, ref, current HEAD, and the SHA the plan names when it names one. Compare the local ref with its remote-tracking ref (`git -C <repo> rev-list --left-right --count <ref>...origin/<ref>`); when the remote is ahead, fast-forward with `github_fast_forward` or record both and judge against the remote, since that is what the plan will meet. The reviewer judges against the current HEAD. When the named SHA differs, `git -C <repo> log --oneline <named>..HEAD -- <files the plan cites>` is the drift, and every commit in it goes into the brief as a lead.
3. **Check it has not already run.** The work rarely lands on the grounding ref: it lands on the branch or worktree the plan says to create. Sweep every ref after the plan's own date (its `created` frontmatter, else its mtime): `git -C <repo> log --all --since=<date> --format='%h %ad %D %s' -- <files the plan cites or creates>`, plus the log of every branch the plan names. A hit means the plan is partly or wholly executed. Say which commits and which phases they cover, and ask whether to review the plan, the code (a `range` from the grounding SHA to that branch, with the plan as the stated intent the claims come from), or both. Usually the code.
4. **Save it** as `extra.plan: true` and `extra.grounding: ['<name> <ref>@<sha>', ...]`, and as one `grounding` row per repo in the brief's What-to-review table.

## Claims a plan carries

Pull these on top of the generic ones (every path, tool name, flag, and number). Each becomes a numbered claim with what would falsify it, read at the grounding HEAD.

- **Existence.** Every file, line range, symbol, route, flag, env var, script, and test the plan names is where it says, and does what it says. A line number is a claim too: it drifts first.
- **Completeness.** "All callers", "the only place", "no migration needed", "already handles X", "nothing else reads it", and each "No change needed" item. The counterexample is a grep hit the plan did not list.
- **Scope.** Everything in Scope or In is built by some step, and nothing in Out is needed by a step that is in.
- **Order.** "Independent of", "can run in parallel", "after X": each phase leaves the repos building and the tests green, or the plan says it does not.
- **Verification.** Each check can fail if the work is wrong, and can run where the plan says it runs (a sandboxed agent session cannot listen on a port, reach a local database, or run the Apple toolchain; the plan either routes that step to the operator or it is a finding).
- **Alternatives.** Each rejected option is rejected for a reason that holds in the code.
- **Unstated work.** What the change must also touch that the plan does not mention: tests, docs, migrations, the templates or mirrors the repo keeps in step, the release notes.

**Settled decisions.** Lines the operator decided ("Decided:", an Interview Log answer, a deliberate Out) are not claims. The brief lists them under their own line so the reviewer does not reopen them; a finding against one needs a fact from the code the decision could not have known, otherwise it is taste. Check each against the drift commits first: a decision the code has since overtaken (a later commit does what the plan deferred or ruled out) is listed as a claim instead, naming the commit.

## Also look for

A phase that ships a half-migrated state, a data or settings migration without an idempotent rerun or a rollback, a step whose output the next step assumes but nothing produces, two sections that disagree (Scope against the task breakdown, the architecture diagram against the endpoint list), an authorization or confidentiality gap in a new surface, work routed to a tool or permission the executing session does not have, a mirror or second repo named once and then forgotten.

## Verifying a plan finding

The verifier gets the rubric, the finding, the plan path, and every grounding repo with its HEAD. The rubric maps as follows, and the verifier is told so:

1. **Is it as described?** Anchor by the quoted plan lines, then open what the plan points at in the grounding repo at HEAD.
2. **Is it the plan's defect?** Yes when the plan says something wrong or leaves out something it needs. A fact of the code the plan correctly works around is not; a pre-existing code defect the plan builds on without noticing is, since executing the plan makes it load-bearing.
3. **Is the failure reachable?** Follow the plan as written, step by step, as the executing engineer or agent would, and name the step where it goes wrong: the wrong edit, the failing build, the missed caller, the check that passes on broken work.
4. **Does something already prevent it?** A later step, the repo's tests, or a sentence elsewhere in the plan that covers it.
5. Skipped (linter, type checker).
6. and 7. as written.

The scale and the protected-subject floor stay. For a plan, protected also covers a step that deletes, migrates, or rewrites the operator's data or settings.

## Acting on a verdict

- **Confirmed, factual** (a wrong path, a stale line number, a missing caller, an unrunnable check, a missing step): edit the plan in place, smallest correct change. Quote the before and after in the Disposition, since a plan under `<HOME>` has no commit to diff against, and name the edited sections in the refreshed brief's fixes-since row.
- **Confirmed, design** (the approach itself, the phase order, what is in or out): the plan is not built yet, so this is the cheapest moment to change it, and it is the operator's call. Put each one to the operator as a question with the finding's evidence and a recommendation (`AskUserQuestion`, one question per finding, at most four per call). On their answer, revise the plan and record the decision as a settled line so no later round reopens it. The Ledger row reads verdict `confirmed`, state `fixed` with the section revised, or `rejected` with the operator's reason when they keep the plan as is. Unanswered, it stays `open`.
- **Plausible, rejected, inherited** as in the skill.

## Closing a plan review

A plan closes when the Ledger has no open rows and every design question has an answer. The closing line says whether the plan is ready to execute, and at which grounding HEADs; a plan the operator approved earlier in plan mode and that changed under review is re-approved before anyone executes it.
