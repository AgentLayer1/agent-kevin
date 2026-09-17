# Dossier template

One file per review target, for the whole loop. The implementer creates it on round 1 with `report_write` and edits it in place from then on; the reviewer only ever appends a `Findings` section. Fixed section order, never reordered. Placeholders in `<angle brackets>`; drop the guidance lines in *italics* from the output. The frontmatter is rendered by `report_write` on round 1; later rounds edit its `round`, `status`, `heads`, and `verdict` fields in place.

````markdown
# <Change title, as the branch or PR states it>

> Round <n> · <awaiting reviewer · awaiting verification · closed> · heads: <repo `sha`> · <repo `sha`> · <repo `sha`>

*The status line is the whole state of the loop for a reader in a hurry. The implementer rewrites it every round.*

---

## How this document works

Two sessions of the same agent share this file, each on a different model, so the sections are named by role rather than by name. **The implementer** owns the Brief, the Ledger, and every Disposition section; it verifies findings against the code, fixes what is real, and commits on the operator's branch. **The reviewer** owns the `Findings` section of the current round only: it appends that section (opening with the model and host it runs on), changes nothing else here, and modifies nothing in the repositories. Findings carry ids `R<round>-<k>`; the Ledger tracks each one across rounds so a settled finding is never re-raised and an open one is never lost. A round is one reviewer pass plus the implementer's disposition of it; when several reviewers run the same round, each has its own lettered Findings section and ids (`R<round>A-<k>`). The operator hands the file back and forth; nothing here is posted anywhere.

---

## Brief for the reviewer

*Rewritten by the implementer every round. It is the prompt: self-contained, model-neutral, and free of anything from the agent home (memory, feedback, private notes). Code facts and task intent only.*

Adversarially review <the change in one clause>. Assume it is broken and prove where. Read-only: modify nothing in the repositories; read-only checks (a build, a test run, a script that inspects) are welcome and should be reported as what you ran.

### Why this matters

<Three to six sentences on the product stakes: who uses this, what a silent regression costs them, what deliberate non-obvious behavior the code carries that a reader would mistake for a bug. The reviewer weighs risk like a user, so give it the user.>

### What to review

| Repository | Path | Range | Role |
|---|---|---|---|
| <name> | `<absolute path>` | `git diff <base>...<head>` | <app · engine · foundation> |

<One paragraph: what the change does as a whole, grouped by concern, and which commits or files are the follow-up batch if there is one.>

*On rounds ≥ 2 add the fixes since the last round as their own rows: `git diff <previous head>...<head>` per repository, labelled "fixes since round <n-1>". Those fixes were written under review pressure and are as suspect as the original change.*

### Stance

Read the code, not the commit messages. The messages assert things ("equivalent", "preserves ordering", "no early return precedes it"); each assertion is a claim to test, and where one is wrong, say so plainly. Judge the head commit with its callers and callees, not the diff in isolation: regressions live in unchanged code that relied on the old behavior. Unchanged code that predates the change is not a finding unless the change makes it worse or newly reachable; say which. Disagreement with the approach is welcome; state it directly.

### Bug classes already seen here

<One paragraph per class that already bit this change or this codebase: what it looked like, where it was found, why it compiles or passes tests anyway, and where the remaining instances would hide. This is the reviewer's best lead; write it as one.>

### Claims to falsify

*Numbered. Each names the file or symbol, what the author claims, and what a counterexample would look like. Settled claims are retired between rounds; every fix the implementer lands becomes a new claim. Keep the numbering continuous across rounds so ids in the Ledger stay stable.*

1. <Symbol or file>: <the claim>. <What to check, and what would falsify it.>
2. …

### Also look for

<One paragraph, comma-separated: the generic hazards this kind of change carries (ordering changes, error paths that now log instead of propagate, work moved into a task that can be dropped, retain cycles from changed capture lists, conformances that paper over a thread mismatch, anything that changes when the domain's key event happens).>

### Output contract

Read the whole of every range above; do not sample. Write your findings under the empty heading `## Round <n> — Findings (Reviewer)` already at the end of this file (or the lettered slot heading your handoff line named), and change nothing else in the file. Re-read the file immediately before writing and write only your section. Open with the model and host you are running on, the heads you read (`repo: sha`, one line each), and whether the working trees were clean. Then findings ordered by risk to a real user, verified ones first and suspected ones under their own heading, each in this shape:

```
### R<n>-<k>. <claim in one sentence>
file: <repo-relative path>
line: <line on the head commit>
code: <the anchored line or lines, verbatim>
old: <what the code did before the change>
new: <what it does now>
failure: <concrete inputs or state → the wrong outcome the user sees>
conditions: <what has to be true for it to trigger>
confidence: high | medium | low
fix: <the smallest correct change, as a diff or one sentence>
introduced: yes | made-worse | pre-existing
```

The `code:` lines are the anchor of record; a finding whose snippet is not in the file cannot be verified, so copy it exactly. One finding per defect; a pattern repeated in six places is one finding with six anchors. Where an area is genuinely clean, say so in one line rather than padding. Close with one line per claim above: `claim <k>: falsified · holds · not checked`, and one line on what you ran and did not run. When you are done, reply in chat with only the path of this file.

---

## Ledger

*One row per finding across all rounds, updated by the implementer on every `verify`. State: `open` (not yet dispositioned or still unsettled) · `fixed` (with the commit) · `rejected` (with the receipt) · `inherited` (pre-existing, tracked elsewhere or left as is). Rounds 1–2 imported from prior reports link the report instead of a section.*

| Id | Claim | Raised | Verdict | Resolution | State |
|---|---|---|---|---|---|
| R1-1 | <short claim> | round 1 | confirmed | <repo `sha`> | fixed |
| R1-2 | <short claim> | round 1 | rejected | <what was read or run> | rejected |
| R1-3 | <short claim> | round 1 | pre-existing | <task id or "left as is"> | inherited |

---

## Round 1 — Findings (Reviewer)

*Written by the reviewer. The implementer never edits this section; a correction goes in the Disposition.*

---

## Round 1 — Disposition (Implementer)

*Written by `verify`. Verdict on the round in one sentence first, then one row per finding, then the checks that back the verdicts.*

<One sentence: how accurate the round was and what the real catch was.>

| Id | Verdict | Fix or receipt |
|---|---|---|
| R1-1 | Confirmed | <repo `sha`>: <what changed, one line> |
| R1-2 | Rejected | <what was read or run that disproves it> |
| R1-3 | Inherited | <why it is not this change's problem, and where it is tracked> |

**Checks after the fixes**

| Repository | Build | Tests |
|---|---|---|
| <name> | <✅ scheme · ❌ · –> | <n passed / k failed · –> |

**Not done this round:** <fixes deferred to the operator's call, checks that could not run, one line each.>

---

## Round 2 — Findings (Reviewer)

…
````

## Notes for the writer

- The Brief is the only part of the file the reviewer must read; write it so the reviewer can start without opening anything else in the agent home.
- Retiring a claim means deleting it from the Brief, not striking it through; the Ledger keeps the history.
- The status line, the frontmatter `round`, and the newest section heading must agree. Check all three before handing the file back.
- No em-dashes in prose; the section headings above are the one fixed exception, and the reviewer's heading must match them exactly for the next `verify` to find it.
