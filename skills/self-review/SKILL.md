---
name: self-review
description: Interactive session where you and Kevin look at accumulated feedback together and decide what to change in Kevin's prompts or skills. Run when you've accumulated enough corrections in raw/user/feedback.md to be worth processing.
disable-model-invocation: true
---

# Self-Review

Close the feedback loop. Turn what you've told Kevin into actual edits — with you in the room.

## Core principle

**You drive, Kevin surfaces.** Kevin reads the feedback, names the patterns, and proposes specific edits. You pick which to apply, which to skip, which to watch. Edits happen synchronously in the same session. No pending files, no approval ceremony, no async flows.

**One good edit beats five tepid ones.** If the signal is weak, say so and stop. Don't manufacture change.

**Depth over breadth.** A correction that was already added as a rule and got violated *again* is worth ten brand-new themes. Trace recurrence; don't just count instances.

## Protocol

### 1. Cast a wide signal net

Don't stop at the synth — pull raw evidence from every surface where corrections actually land.

**Required reads (in this order):**

1. `<HOME>/knowledge/memory/index.md` → `## Learnings` (the synth) **and** `## Pending`. Pending items >2 cycles old need re-evaluation, not auto-skip.
2. `<HOME>/knowledge/raw/user/feedback.md` — full file, not just the tail. The synth flattens nuance you'll need later (escalation language, repeated phrasing).
3. `<HOME>/knowledge/raw/sessions/` — last 7 days of session logs. Many corrections happen mid-conversation and never become formal feedback entries. Grep for correction phrases: `no `, `don't`, `stop`, `wrong`, `actually`, `you didn't`, `that's not`, `i told you`, `again`, `still`. Also grep for confirmation phrases: `yes exactly`, `perfect`, `that's right`, `keep doing`, `exactly what`. Save successes too — they validate non-obvious choices.
4. Recent task threads — scan tasks updated in the last 7 days. Search `[!quote]` blocks for the same correction phrases. Threads are where in-flight corrections land.
5. `git log --format='%h %ai %s' -50` in `<HOME>/identity/` and the plugin repo's `skills/` — commits matching prior cycle dates are addressed work. Note the dates so you can compute "violations after fix".
6. `<HOME>/knowledge/concepts/` — list every article. This is where *implemented and distilled* decisions live. A theme that maps to an existing concept article means the *thinking* landed but the *behavior* didn't — different fix shape (enforcement gap, not knowledge gap).
7. `.claude/plans/` — in-flight, unimplemented plans only. Use to (a) de-dup if a Track B proposal already exists, (b) age-sweep — plans >14 days old without follow-through are stuck.
8. The plugin's `skills/` directory — what's installed. Reference for Track C — don't propose installing or creating something already covered.

### 2. Cluster, count, classify

Build a per-theme record. For each candidate:

- **Instances** — every distinct correction or error, with `date · source · brief quote`. Don't paraphrase from the synth; quote the raw entry.
- **Escalation language** — did you use words like "never", "stop", "across the board", "again", "still"? Mark severity.
- **Cycle count** — has this theme appeared in prior self-reviews? Check `git log --grep='self-review'`. A theme in cycle 3+ is a signal that prior fixes didn't stick.
- **Coverage audit** — grep the prompt surface AND the distilled knowledge for the rule's keywords:
  - `<HOME>/identity/{SOUL,IDENTITY,CLAUDE}.md` (loaded every session)
  - `<plugin>/skills/*/SKILL.md` (skill-scoped guidance)
  - `<HOME>/knowledge/concepts/*.md` (distilled patterns — if the theme matches a concept article, the thinking is canonized but the behavior isn't sticking)
  - The plugin's TS source for runtime guards (hooks, validators)

  Classify the current state: **missing** / **buried** / **present-but-violated** / **present-and-working**.
- **Violations after fix** — for themes that match a prior cycle: count violations *after* the fix-commit date. Zero = working. One+ = the fix didn't stick.

Rank themes by `(severity × instance count × cycle count)`. Drop anything with fewer than two independent signals or that's `present-and-working`.

If nothing clears the bar, say so and stop. Don't manufacture change.

### 3. Propose 1–5 concrete changes

The coverage audit determines the proposal shape:

| Current state | Proposal shape |
|---|---|
| Missing | **Add** rule (Track A — pick the right surface based on scope: identity → SOUL, procedural → CLAUDE, skill-specific → skill body) |
| Buried | **Promote** — move or duplicate the rule to a higher-salience surface (Track A) |
| Present-but-violated | **Escalate** — convert prompt rule to runtime enforcement, hook, or pre-flight check (Track B plan), or move to SOUL.md `## Core Truths` if the rule is identity-level |
| Skill-shaped recurring procedure (3+ instances, same multi-step workflow) | Track C — install or create skill |

**Track A — Prompt / skill edits.** For each:
- **Target file** — exact path.
- **Current text** — read the file first, quote the actual lines.
- **Proposed text** — the replacement.
- **Coverage state** — missing / buried / present-but-violated.
- **Why this surface** — one sentence on why this file vs. another.

**Track B — Code changes.** Never edit code in this skill. Write plans only.

Check `.claude/plans/` — if a plan for the same theme exists, update it. Write to `.claude/plans/self-review-YYYY-MM-DD-<slug>.md`:
- **Motivation** — signals with specifics.
- **Coverage gap** — what already exists, why it's insufficient.
- **Files touched** — exact paths.
- **Proposed change** — code sketch.
- **Trade-offs** — what breaks, what gets simpler.
- **Implementation steps** — ordered list a future session can follow.

**Track C — Skill install or create.** Only when the signal is a recurring multi-step procedure. Name source, install path, addressed pattern.

Stay surgical. Small targeted changes beat sweeping rewrites.

### 4. Aging plan sweep

For each `.claude/plans/*.md` with mtime >14 days, check whether the work landed. If it's stuck, propose: **re-surface**, **downgrade**, or **close**.

### 5. Discuss, then edit or plan

Walk through proposals one at a time. Your call on each:
- **Apply** (Track A) → Edit tool, now.
- **Write plan** (Track B) → create/update `.claude/plans/`. No code edits.
- **Install / Create** (Track C) → command or `skill-creator`.
- **Skip** → drop it.
- **Revise** → incorporate redirect, re-propose.
- **Watch** → noted, move on.

Confirm each edit landed before moving on.

### 6. Wrap up

Summarise:
- X prompt/skill edits applied
- Y code-change plans written (path — implement in a separate session)
- V skills installed or created
- Z proposals skipped
- W themes parked on watch
- N aging plans surfaced

## Hard rules

- **Never edit `IDENTITY.md`.** Identity changes aren't in scope. Flag if a theme suggests one — don't propose it.
- **Never edit `<HOME>/knowledge/memory/index.md` or `<HOME>/knowledge/raw/user/feedback.md`.** Inputs, not outputs. The compile pipeline owns them.
- **Never install a skill without explicit in-session approval.**

## Quality gate before proposing

For each proposal, all four must be yes:

- Did you actually read every target file (not just paraphrase)?
- Is the evidence specific (timestamps, quotes, log lines, file:line)?
- Did you run the coverage audit?
- If this rule already exists somewhere: do you know whether it's been violated *after* it was introduced?

If any answer is soft, sharpen or drop.
