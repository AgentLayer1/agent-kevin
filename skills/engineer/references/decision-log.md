# Decision log

A reviewable trail for long, autonomous, or multi-phase work that the operator reviews after stepping away: one TSV, one row per decision.

**Columns:** `ts` (ISO 8601), `phase`, `decision` (what was chosen or done), `why` (plain words), `evidence` (a pointer: SHA, `file:line`, artifact path; never a paragraph), `result` (`tests green`, `reverted`, `pixel-diff 0`, `INCONCLUSIVE`, `open`).

```
ts	phase	decision	why	evidence	result
2026-05-24T09:40:00Z	harness	screenshotted the old version before changing anything	to compare old against new and catch any visual change	scripts/snapshot.sh	saved 120 reference screenshots
2026-05-24T12:30:00Z	widget	threw out a helper's work because its screenshots were blank	checked the real files instead of trusting its summary	worktree reset	reverted, tightened the brief
```

- **Where:** a working artifact, not committed by default. Put it in the run's scratch directory (`mktemp -d`), or at `.audit/<slug>.tsv` in the worktree when several runs share it. Commit it only when a reviewer needs the trail to trust the result. Link it from the handoff either way.
- **What earns a row:** a fork chosen, a unit completed with its check result, a pivot or revert and its trigger, a blocker, a gate fixed. One row per loop iteration. Skip the trivial.
- **Append-only.** A wrong call gets a new row that supersedes it. Write rows the way you'd tell a colleague, in plain words. Keep cells single-line, strip tabs and newlines, and prefix a cell that starts with `=`, `+`, `-`, or `@` with a single quote.
- **Audit it against the transcript before handing back:** every row maps to a real action, every evidence pointer resolves and shows what the row claims, an unlogged fork or pivot is a gap to add, and padding goes. Fix the log, not the story.
- **Get a second model on the trail** (the adversarial-review skill, with the log and the transcript as the target) for weak evidence, skipped verification, risky choices, and anything a casual skim would miss. The handoff ends with an **Attention** section listing what it flagged, or "no flags".

**Reading it:** `column -s$'\t' -t decisions.tsv` in a terminal. GitHub renders a committed TSV as a table.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `show-me-your-work` skill (MIT, Copyright (c) 2026 Lauren Tan).
