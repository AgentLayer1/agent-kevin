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
5. `git log --format='%h %ai %s' -50` in the **plugin repo** (`skills/` and `templates/`) — commits matching prior cycle dates are addressed work. Note the dates so you can compute "violations after fix". The HOME repo's git dir is separated and lives outside the sandbox, so `git log` will **not** run against HOME in-session — don't try. Use the plugin repo's history plus the concept articles (step 6) and the self-review watermark (step 9) as the HOME-side signal instead.
6. `<HOME>/knowledge/concepts/` — list every article. This is where *implemented and distilled* decisions live. A theme that maps to an existing concept article means the *thinking* landed but the *behavior* didn't — different fix shape (enforcement gap, not knowledge gap).
7. `<HOME>/reports/plans/` — in-flight, unimplemented plans only. **Consider only self-review-authored plans**: files with frontmatter `skill: self-review` (these are written by `report_write`, date-time-prefixed filenames). The same folder also holds raw Claude Code plan-mode dumps (random-slug filenames, no frontmatter) — **ignore those**; they aren't self-review's to sweep. Use the self-review plans to (a) de-dup if a Track B proposal already exists, (b) age-sweep — plans >14 days old without follow-through are stuck.
8. The plugin's `skills/` directory — what's installed. Reference for Track C — don't propose installing or creating something already covered.
9. `<HOME>/.kevin/review.json` — the processing watermark from the last run (`lastProcessed` date, `confirmedWorking` rule list). If it exists, treat feedback/session entries dated on or before `lastProcessed` as **already triaged**: only re-open one if it recurred *after* that date (a fix that didn't stick). Rules in `confirmedWorking` are validated — don't second-guess or re-propose them unless they've since been violated. If the file is absent, this is a first run: process everything. You write this file in step 6.

### 2. Cluster, count, classify

Build a per-theme record. For each candidate:

- **Instances** — every distinct correction or error, with `date · source · brief quote`. Don't paraphrase from the synth; quote the raw entry.
- **Escalation language** — did you use words like "never", "stop", "across the board", "again", "still"? Mark severity.
- **Cycle count** — has this theme appeared in prior self-reviews? Check `git log --grep='self-review'`. A theme in cycle 3+ is a signal that prior fixes didn't stick.
- **Coverage audit** — grep the prompt surface AND the distilled knowledge for the rule's keywords:
  - `<HOME>/{SOUL,IDENTITY,CLAUDE}.md` (HOME root — loaded every session)
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
| Present-but-violated | **Escalate** — convert the prompt rule to runtime enforcement, a hook, or a pre-flight check (Track B plan), or move it to SOUL.md `## Core Truths` if the rule is identity-level. A present-but-violated rule has already proven prose doesn't hold it — the Track B plan **must** specify a verification artifact (a hook, validator, or eval/test that fails when the rule is broken), not just stronger wording. No artifact, no escalation. |
| Generic + non-personal Track A rule worth shipping to every agent | Track D — promote to the plugin template (`templates/`), **after a framing audit** |
| Skill-shaped recurring procedure (3+ instances, same multi-step workflow) | Track C — install or create skill |

**Track A — Prompt / skill edits.** For each:
- **Target file** — exact path.
- **Current text** — read the file first, quote the actual lines.
- **Proposed text** — the replacement.
- **Coverage state** — missing / buried / present-but-violated.
- **Why this surface** — one sentence on why this file vs. another.

**Track B — Code changes.** Never edit code in this skill. Write plans only.

Check `<HOME>/reports/plans/` — if a plan for the same theme exists, update it via the
`Edit` tool. Otherwise, call the `mcp__plugin_agent-kevin_kevin__report_write` MCP
tool to create a new self-review plan — it writes the file and inserts a one-line
entry into `<HOME>/reports/index.md` in a single atomic call:

```
report_write({
  category: 'plans',
  slug: 'self-review-<short-theme-slug>',
  title: <e.g. 'Self-review — morning briefing missing perplexity fallback'>,
  skill: 'self-review',
  status: 'draft',
  body: <full plan markdown with the sections below, no frontmatter>
});
```

Plan body sections:
- **Motivation** — signals with specifics.
- **Coverage gap** — what already exists, why it's insufficient.
- **Files touched** — exact paths.
- **Proposed change** — code sketch.
- **Trade-offs** — what breaks, what gets simpler.
- **Implementation steps** — ordered list a future session can follow.

**Track C — Skill install or create.** Only when the signal is a recurring multi-step procedure. Name source, install path, addressed pattern.

**Track D — Promote to the plugin template.** A Track A rule only lands in *this* HOME (`<HOME>/{SOUL,CLAUDE}.md`). When the rule is generic, durable, and non-personal, it should also flow to every future agent-kevin user via the plugin template. Propose Track D *in addition to* the Track A edit when all of these hold:

- The rule is **universal** — it would help any operator, not just the current one (a coding standard, a workflow guardrail), not an operator-specific fact (a project, a person, an account).
- It's **durable** — a settled preference, not an in-flight experiment.
- It survives a **framing audit** (mandatory before any text goes into a shared template):
  - No personal references, real repo names, private accounts, or private path/fixture data. Genericize to `Acme` if an example is needed.
  - Re-frame personal-agent assumptions (personal accounts, personal cost) for the generic context a fresh-install template runs in.

For each Track D proposal:
- **Source rule** — the Track A edit it derives from.
- **Target template file** — `templates/SOUL.md` or `templates/CLAUDE.md` (exact path).
- **Generic text** — the framing-audited wording (NOT a copy of the personal Track A text).
- **Audit note** — one line confirming what was genericized/re-framed, or "nothing personal to scrub."

Editing `templates/` is an outward-facing change to shared artifacts. Propose the diff; **do not commit, push, or `/release` without a fresh explicit go.** Apply the template `Edit` only after in-session approval of that specific change.

Stay surgical. Small targeted changes beat sweeping rewrites.

### 4. Aging plan sweep

For each self-review-authored plan (frontmatter `skill: self-review`) in `<HOME>/reports/plans/*.md` with mtime >14 days, check whether the work landed. If it's stuck, propose: **re-surface**, **downgrade**, or **close**. Skip raw plan-mode dumps (no frontmatter) — they're the harness's, not self-review's.

### 5. Discuss, then edit or plan

Walk through proposals one at a time. Your call on each:
- **Apply** (Track A) → Edit tool, now (HOME files only).
- **Write plan** (Track B) → create/update `<HOME>/reports/plans/`. No code edits.
- **Install / Create** (Track C) → command or `skill-creator`.
- **Promote** (Track D) → Edit `templates/` **only after an explicit go on that specific diff**; never commit/push/`/release` here.
- **Skip** → drop it.
- **Revise** → incorporate redirect, re-propose.
- **Watch** → noted, move on.

Confirm each edit landed before moving on.

### 6. Wrap up

Summarise:
- X prompt/skill edits applied (Track A)
- Y code-change plans written (Track B — path; implement in a separate session)
- V skills installed or created (Track C)
- U template promotions proposed / applied (Track D)
- Z proposals skipped
- W themes parked on watch
- N aging plans surfaced

Then **persist that summary** via the `mcp__plugin_agent-kevin_kevin__report_write`
MCP tool so each cycle leaves an audit trail of what changed (HOME git doesn't run
in-session, so this report is the only narrative record of the run):

```
report_write({
  category: 'briefings',
  slug: 'self-review',
  title: <e.g. 'Self-review — 2026-06-25 (3 edits, 1 plan, 2 watched)'>,
  skill: 'self-review',
  body: <the summary above, with each Track A edit, Track B plan path, and watched theme named>,
  status: 'draft'
});
```

Surface `📄 Saved to <path>` (the absolute `path` the tool returns, not `relPath` — so it's command-clickable in any terminal) to the operator. Skip the report only when the run cleared the bar with nothing to change (step 2 stopped early) — there's no cycle to record.

Then **update the watermark** at `<HOME>/.kevin/review.json` so the next run doesn't re-litigate what you just triaged:

```
{
  "lastProcessed": "<today, YYYY-MM-DD>",
  "lastRun": "<today>",
  "confirmedWorking": ["<rule slug>", ...],   // rules validated by success signals or a zero-violation-after-fix check; carry prior entries forward
  "watching": ["<theme slug>", ...]            // themes parked on watch this cycle
}
```

`confirmedWorking` is where the success/confirmation signals you harvested in step 1.3 actually land — a rule that earned a "yes exactly / keep doing" or shows zero violations after its fix-commit goes here so future runs leave it alone. Merge with the prior file's list; don't drop entries unless a rule has since been violated. This file is the only durable HOME-side memory the skill has (HOME git doesn't run in-session), so writing it is not optional.

## Hard rules

- **Never edit `IDENTITY.md`.** Identity changes aren't in scope. Flag if a theme suggests one — don't propose it.
- **Never edit `<HOME>/knowledge/memory/index.md` or `<HOME>/knowledge/raw/user/feedback.md`.** Inputs, not outputs. The compile pipeline owns them.
- **Never install a skill without explicit in-session approval.**
- **Never edit `templates/` (Track D) without a fresh explicit go on that specific diff,** and never commit, push, `/release`, or tag from this skill. Outward-facing release ops are maintainer-gated.
- **The HOME files this skill writes are `<HOME>/.kevin/review.json`** (the watermark, step 6) **and the cycle-summary report** under `<HOME>/reports/briefings/` (also step 6). Everything else under `<HOME>/` is read-only except the Track A prompt edits and Track B plans.

## Quality gate before proposing

For each proposal, all four must be yes:

- Did you actually read every target file (not just paraphrase)?
- Is the evidence specific (timestamps, quotes, log lines, file:line)?
- Did you run the coverage audit?
- If this rule already exists somewhere: do you know whether it's been violated *after* it was introduced?

If any answer is soft, sharpen or drop.
