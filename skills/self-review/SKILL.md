---
name: self-review
description: Interactive maintenance pass over the agent's own instructions and memory, run with the operator. Prunes first (stale memory, rules the model or a guard now covers, dead references, duplicated learnings), then turns accumulated feedback into prompt, skill, or code-plan changes, and promotes generic fixes to the plugin (edited in place for a local checkout, written up as an upstream proposal for a marketplace install).
disable-model-invocation: true
---

> Operator-invoked only. Run this when the operator named this skill, or when a skill the operator invoked calls for it as a documented step; otherwise stop and ask before doing anything. Claude Code enforces this through the frontmatter above, Codex does not.

# Self-Review

Keep the agent's context lean and correct, and close the feedback loop, with the operator in the room.

## Core principles

**Subtract before you add.** Everything loaded at session start is paid for on every turn, and stale text does worse than cost tokens: an outdated fact gets acted on, a superseded rule fights its replacement, a rule the model already follows buries the ones it doesn't. Every cycle runs the prune pass first. A line earns its place only if deleting it would change behavior.

**The operator drives, the agent surfaces.** Read the evidence, name the patterns, propose specific edits and deletions. The operator picks. Edits happen in this session. No pending files, no async approval.

**One good change beats five tepid ones.** If the signal is weak, say so and stop.

**Depth over breadth.** A rule that was added and then violated *again* is worth ten new themes. Trace recurrence; don't just count instances.

## Step 0 — Resolve paths, install mode, and context weight

```bash
HOME_DIR="${KEVIN_HOME:-$PWD}"
[ -f "$HOME_DIR/SOUL.md" ] || echo "NOT_AN_AGENT_HOME: $HOME_DIR"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-<SKILL_BASE_DIR>/../..}"   # under Codex replace <SKILL_BASE_DIR> with this skill's base directory
bun "$PLUGIN_ROOT/skills/self-review/scripts/plugin-source.ts" --home "$HOME_DIR"
bun "$PLUGIN_ROOT/skills/self-review/scripts/context-weight.ts" --home "$HOME_DIR"
```

`NOT_AN_AGENT_HOME` → stop and ask the operator to relaunch from the agent home.

`plugin-source.ts` prints `{ plugin, mode, loaded, source, repo, hosts, candidates, repository }`. It counts a checkout only when a host enables the plugin from it (Claude: this home's `settings.local.json`, then its `settings.json`, then the user's, then an install record for this home or the user; Codex: the `[plugins]` table), never a host cache even one that kept git metadata (`loaded.cache` says whether the running copy is one). Host directories follow `CLAUDE_CONFIG_DIR` / `CODEX_HOME`. Managed (policy) settings are not read. Exit 2 means it could not check (no `git`, or git refused the directory): stop and say so rather than assuming a mode:

- **`contributor`**: every enabled registration, and the loaded copy itself, resolve to one git checkout at `source` (inside the repository at `repo`). Plugin-level fixes can be edited there.
- **`consumer`**: no enabled registration is a git checkout; the loaded copy is a host cache the next update overwrites. Never edit it. Plugin-level fixes become a local override plus an upstream proposal for `repository` (Step 4, Track D).
- **`ambiguous`**: the hosts are enabled from different checkouts (`candidates` names them). Ask the operator which one is upstream before any Track D edit.

`context-weight.ts` prints the **always-loaded stack per host**, with bytes per file and a total. The two stacks differ: Claude Code loads the bridge, everything it `@`-imports (recursively, prose only: an `@path` inside a fenced block or a code span is not an import, and a bare `@word` that names no file is a mention), and every `.md` under `.claude/rules/` without a `paths:` scope; Codex loads `AGENTS.md` natively and gets the identity stack (SOUL, IDENTITY, USER, the knowledge index, the memory index, the task dashboard) from the SessionStart hook, never the bridge or the rules. A non-zero exit means an import did not resolve: fix or report that before using the totals. Record both totals as this cycle's baseline; the wrap-up reports the deltas. A rules-file deletion is a Claude-only saving; say so.

## Step 1 — Cast a wide signal net

Read every surface where corrections and decay actually show up.

1. `<HOME>/knowledge/memory/index.md`, the whole file. `## Learnings` is the feedback synth; the other sections are the main prune target.
2. `<HOME>/knowledge/raw/user/feedback.md`, the full file, not the tail. The synth flattens nuance you'll need (escalation language, repeated phrasing). Note entries headed `— graduated: <theme>` or `— graduated-rule: <theme>`: those are prior cycles' graduation markers.
3. `<HOME>/knowledge/raw/sessions/`, the last 7 days (or since the watermark, whichever is longer). Grep for correction phrases: `no `, `don't`, `stop`, `wrong`, `actually`, `you didn't`, `that's not`, `i told you`, `again`, `still`, `please`, `before you`, `approval`. Also confirmation phrases: `yes exactly`, `perfect`, `that's right`, `keep doing`, `exactly what`. Successes validate non-obvious choices. Then, for every `graduated:` marker and every `retired` watermark entry, grep the same window for the rule's own key words (from the marker's quoted rule or the retired text in its report): a politely worded correction can slip past a phrase list, and a graduated rule breaking again is exactly the recurrence the markers cannot see on their own.
4. Task threads updated in the last 7 days: `[!quote]` blocks with the same phrases.
5. The prompt surface, read in full: `<HOME>/AGENTS.md` (the manual), `<HOME>/.claude/CLAUDE.md` (the Claude bridge), `<HOME>/SOUL.md`, `<HOME>/USER.md`, `<HOME>/.claude/rules/*.md`, and `<HOME>/.claude/skills/*/SKILL.md` if the home has custom skills. `IDENTITY.md` is read for context only.
6. `<HOME>/knowledge/concepts/` and `<HOME>/knowledge/user/`: list every article. A theme that maps to a concept means the *thinking* landed but maybe not the *behavior* (enforcement gap, not knowledge gap). An article contradicted by current state is a prune candidate.
7. Git history. Plugin side: `git -C <source> log --format='%h %ai %s' -50 -- skills templates mcp-server/src` in contributor mode, or the `CHANGELOG.md` beside `$PLUGIN_ROOT` in consumer mode. Commits and releases after a cycle's date are addressed work, so you can compute "violations after fix". Home side: try `git -C "$HOME_DIR" log --oneline -30`; homes with a separated git dir outside the sandbox refuse it, and then the prior cycle reports (item 9) are the home-side history.
8. `<HOME>/reports/plans/`: self-review-authored plans only (frontmatter `skill: self-review`). The folder also holds raw plan-mode saves with no frontmatter; ignore those.
9. Prior cycle reports: `<HOME>/reports/briefings/*self-review*.md`. These are the cycle count: a theme named in two prior reports is in its third cycle.
10. `$PLUGIN_ROOT/skills/`: what's installed, so Track C never proposes something already covered.
11. `<HOME>/.kevin/review.json`, the watermark. Feedback and session entries dated on or before `lastProcessed` are already triaged; re-open one only if it recurred after that date. Rules in `confirmedWorking` are validated; don't re-propose them unless violated since. Entries in `retired` were removed on trial; any violation after their date means restore them (Step 2). Absent file = first run: process everything.

## Step 2 — Prune pass

Build a **deletion manifest** before any additive proposal. Every candidate needs evidence you verified this session (a `grep` hit, an `ls` miss, a quoted line, a commit), not a hunch. Classes:

| Class | What it looks like | Action |
|---|---|---|
| **Graduated** | A `## Learnings` theme whose rule already lives on a surface with the **same reach**: loaded in every session on every host the operator uses (`AGENTS.md`, `SOUL.md`, `USER.md`) or enforced by a hook or validator that runs everywhere. A skill body, a path-scoped rule, or a `.claude/rules/` file (Claude-only) is narrower than Learnings, so a theme covered only there is **not** graduated; move the rule to the manual first, then graduate. | Append a `graduated:` marker (below). Never hand-edit Learnings; compile regenerates it from the feedback log. |
| **Superseded** | A rule, fact, or decision contradicted by a later decision, the current code, or the current config. Check the machine, not the docs. | Delete, or rewrite to the current truth. |
| **Dead reference** | Names a file, tool, skill, flag, env var, path, or version that no longer exists. Verify with `ls` / `grep`. | Delete, or fix the reference. |
| **Enforced elsewhere** | Prose for a rule a hook, validator, test, or harness setting now holds. | Shrink to one line pointing at the guard, or delete. |
| **Model default** | A line on a prompt surface (`AGENTS.md`, `SOUL.md`, a rule file, a template) stating generic practice the current model already follows unprompted ("read before editing", "write clean code"), with zero violations since the watermark and no matching `## Learnings` theme. A Learnings theme is an operator correction by definition, so it never qualifies. Models improve; instructions written for an older one go stale. | **Retire on trial:** remove it and log it in the watermark's `retired` list with the surface it came from. Later cycles restore it if it's violated after that. |
| **Stale memory** | In `memory/index.md`: Active Threads that are done or dormant, Pending items already closed (check the task frontmatter or the artifact), Recent Decisions older than 14 days, Key Context facts that went false. Compile's own budgets (`mcp-server/src/knowledge/compile.md`: 30KB total, per-section caps) are a ceiling, not a target. | Delete, or move decisions into `memory/archive/decisions-YYYY-MM.md` (compile's archive convention). |
| **Stale article** | A concept or user-facet section superseded by current state. | Rewrite or delete the section; update `knowledge/index.md` if an article goes. |
| **Local override shipped upstream** | A home-local rule or custom skill added as a consumer workaround whose fix is now in the installed plugin. | Delete the override. |
| **Stuck plan** | A self-review plan over 14 days old with no follow-through. | Re-surface, downgrade, or close (set `status`, add a closing line). |

Run `knowledge_lint` without `fix` during the scan (it writes only its own report: dead wikilinks, orphans, invalid frontmatter) and fold its findings into the manifest as items to approve. Never call `knowledge_lint({ fix: true })` or `memory_prune` from this skill: both rewrite or delete across the whole home with no per-item approval and would touch protected sections; `sync` runs them on its own cadence.

**Restore first.** Before proposing new retirements, check every entry in the watermark's `retired` list. A correction dated after its `date` that matches the rule means the trial failed: put the text back at `from` (always a prompt surface, never Learnings), drop the entry, and say so in the report. Otherwise increment its `checks`; at `checks: 2` the retirement is permanent and the entry is dropped. This bookkeeping happens every run, including one that changes nothing else.

**Never prune on the "model default" ground** a safety, privacy, confidentiality, faith, or money rule, or anything that encodes this operator's own preference: the model cannot know a preference by default, and insurance rules are cheap. Those leave only on "superseded" or "dead reference", with an explicit go.

**Markers.** Graduating a Learnings theme is an append to the feedback log through the `capture` MCP tool, never an edit of past entries:

```
capture({ kind: 'feedback', label: 'graduated: <theme name as it reads in Learnings>',
          text: 'Rule: <the rule, quoted verbatim from its new home>. Now lives in <path>#<section>. <one line on why the Learnings copy can go>.' })
```

When only one rule inside a broader theme moved (the rest of the theme still earns its place), label it `graduated-rule: <theme name as it reads in Learnings>` with the same `text`: the next compile drops only that rule's wording and keeps the rest of the theme.

**The home must already hold the rule when the marker is written.** Put it on the home's own surface (`<HOME>/AGENTS.md`, `SOUL.md`, `USER.md`) in this run. A Track D edit to `templates/` does not count on its own: it reaches an existing home only after a release and an upgrade, and until then the next compile would drop the Learnings copy with nothing loaded in its place.

The next compile drops the theme (or the one rule) from Learnings and brings it back only if a later correction shows it broke. Quoting the rule is what lets the compiler match a later correction to it; a later correction that names neither the rule nor the action stays undecidable, which is why Step 1 also greps sessions for each graduated rule's own words. Retirements need no marker: they touch prompt surfaces only, and the watermark carries them.

Present the manifest grouped by class, with bytes saved per item. For each item: the exact text or path, the evidence, the action. Get approval per group (`AskUserQuestion` with multi-select under Claude Code, a numbered list under Codex), then apply. Quote every deleted line verbatim in the cycle report so a restore never depends on git.

## Step 3 — Cluster, count, classify the feedback

For each candidate theme:

- **Instances**: every distinct correction, as `date · source · brief quote`. Quote the raw entry, not the synth.
- **Escalation language**: "never", "stop", "across the board", "again", "still". Mark severity.
- **Cycle count**: prior cycle reports that named it (Step 1.9). Cycle 3+ means earlier fixes didn't stick.
- **Coverage audit**: grep the prompt surface (Step 1.5), `$PLUGIN_ROOT/skills/*/SKILL.md`, `<HOME>/knowledge/concepts/*.md`, and the plugin's TS source for runtime guards. Classify: **missing** / **buried** / **present-but-violated** / **present-and-working**.
- **Violations after fix**: count violations after the fix's commit or cycle date. Zero = working (add to `confirmedWorking`). One or more = it didn't stick.

Rank by `severity × instances × cycles`. Drop anything with fewer than two independent signals, or that's present and working. If nothing clears the bar, say so and skip to Step 5 with just the prune results.

## Step 4 — Propose 1–5 changes

| Coverage state | Proposal |
|---|---|
| Missing | **Add** (Track A). Pick the surface by scope: identity → `SOUL.md`, procedure → `AGENTS.md`, Claude-only behavior → `.claude/CLAUDE.md`, path-scoped → a `.claude/rules/` file, skill-specific → the skill. |
| Buried | **Move** it to a higher-salience surface (Track A) and delete the old copy in the same change. Never duplicate. |
| Present-but-violated | **Escalate** to enforcement (Track B plan): prose already failed, so the plan must name a verification artifact (a hook, validator, or test that fails when the rule breaks). No artifact, no escalation. Or move it to SOUL's `## Core Truths` if it's identity-level. |
| Generic, useful to every user of the plugin | **Promote upstream** (Track D), after a framing audit. |
| A recurring multi-step procedure (3+ instances) | **Skill** (Track C). |

**Track A: home prompt edits.** For each: the target path, the current text (read it, quote it), the proposed text, the coverage state, and one sentence on why this surface.

**Track B: code-change plans.** Never edit code in this skill. If a self-review plan for the theme exists in `<HOME>/reports/plans/`, update it with `Edit`. Otherwise create one with the `report_write` MCP tool:

```
report_write({ category: 'plans', slug: 'self-review-<theme>', title: 'Self-review: <theme>',
               skill: 'self-review', status: 'draft', body: <plan markdown, no frontmatter> })
```

Plan sections: **Motivation** (signals with specifics), **Coverage gap**, **Files touched**, **Proposed change** (code sketch), **Trade-offs**, **Implementation steps**. A plan for plugin code names the plugin paths and says which mode it was written in.

**Track C: skill install or create.** Only for a recurring multi-step procedure. Name the source, install path, and the pattern it addresses.

**Track D: promote upstream.** A Track A change only fixes this home. When the fix is **universal** (helps any operator, not a fact about this one), **durable** (a settled preference, not an experiment), and passes the **framing audit**, it should also reach the plugin: `templates/` (what new homes get), a skill body, a compile prompt under `mcp-server/src/knowledge/`, or code (as a Track B plan). The prune pass applies upstream too: an obsolete line in a shipped skill or template is a Track D deletion.

Framing audit, mandatory before any text goes upstream:

- No personal references, real client or repo names, private accounts, or private paths. Genericize to `acme`.
- No literal agent name in `templates/`: they carry `{{AGENT_NAME}}`, which each home resolves to its own agent's name. Hardcoding one reintroduces a name `upgrade` can't reconcile.
- Re-frame personal-agent assumptions (personal accounts, personal cost) for a fresh install.

Then, by install mode:

- **contributor**: propose the diff against the checkout at `source` (under `ambiguous`, the one the operator picked); after a go on that specific diff, `Edit` it there. The edit stays uncommitted in the working tree; commits and `/release` stay with the maintainer. Run the checkout's tests for anything under `mcp-server/` or `skills/*/scripts/`. If the home also carries the Track A copy, say whether it can be deleted once the release lands (next cycle's "local override shipped upstream" check will catch it either way).
- **consumer**: do two things. First, the local fix, so it works today: a home-level override applied as Track A, on a surface every host the operator uses loads (an `AGENTS.md` section; a `.claude/rules/` file only for Claude-only behaviour, since Codex never reads it; a custom skill under `.claude/skills/` for a procedure). Second, an upstream proposal written with `report_write({ category: 'plans', slug: 'self-review-upstream-<theme>', skill: 'self-review', status: 'draft', ... })` whose body is a paste-ready issue for `repository`: the problem, the evidence (framing-audited), and the proposed diff. `<theme>` is kebab-case and at most 39 characters (the slug limit is 60); the full theme name goes in the title. Filing it is outbound: hand the operator the file path and the repo's new-issue URL, and file it yourself only on an explicit go.

For each Track D proposal: the source rule, the target path (checkout path or upstream path), the generic text, and a one-line audit note on what was scrubbed (or "nothing personal to scrub").

## Step 5 — Discuss, then apply

Walk through the proposals one at a time. The operator's call on each: **Apply** (Track A, now) · **Plan** (Track B) · **Install/Create** (Track C) · **Promote** (Track D, only after a go on that specific diff) · **Skip** · **Revise** (take the redirect, re-propose) · **Watch** (park it). Confirm each edit landed before moving on.

## Step 6 — Wrap up

Re-run `context-weight.ts` and summarise:

- Always-loaded context per host: Claude `<before>` → `<after>` bytes, Codex `<before>` → `<after>` bytes
- Pruned: N items (by class), graduation markers appended, retirements restored or made permanent
- Track A edits, Track B plans (paths), Track C skills, Track D promotions (edited in the checkout, or upstream proposals written)
- Skipped, watched, stuck plans surfaced

Persist it with `report_write({ category: 'briefings', slug: 'self-review', title: 'Self-review: <date> (<counts>)', skill: 'self-review', status: 'draft', body })`. The body names every edit, plan path, and watched theme, and quotes every deleted line verbatim under `## Removed`. Surface `📄 Saved to <path>` using the absolute `path` the tool returns. Skip the report only when nothing was pruned or changed.

Then write the watermark `<HOME>/.kevin/review.json`, merging with the prior file:

```json
{
  "lastProcessed": "<today, YYYY-MM-DD>",
  "lastRun": "<today>",
  "confirmedWorking": ["<rule slug>"],
  "watching": ["<theme slug>"],
  "retired": [{ "slug": "<rule slug>", "date": "<today>", "from": "<path>#<section>", "checks": 0, "report": "<relPath of the cycle report holding the removed text>" }]
}
```

`confirmedWorking` takes rules validated by a success signal or zero violations after their fix; carry prior entries forward and drop one only when it's been violated since. A slug lives in at most one list: retiring a rule removes it from `confirmedWorking` and `watching`; restoring it puts it back in neither. `retired` holds each trial retirement, with `checks` counting the later runs that looked for a recurrence and found none, until Step 2 restores it or makes it permanent. Sync reads `lastRun` for its cadence nudge, and `checks` only advances here, so this write happens every run, even one with no report.

## Hard rules

- **Never edit `IDENTITY.md`.** Flag a theme that suggests one; don't propose it.
- **`raw/user/feedback.md` is append-only.** The only write is a `graduated:` or `graduated-rule:` marker through `capture`. Never edit past entries.
- **In `memory/index.md`, never touch `## Learnings` or `## Open Questions`.** Compile regenerates both; use markers for Learnings. Other sections take approved Stale-memory deletions only.
- **Nothing is deleted without approval**, every deleted line is quoted in the cycle report, and no whole-home mutation tool (`knowledge_lint` with `fix`, `memory_prune`, `links_rewrite`) runs from this skill.
- **Never edit the host's plugin cache** (`~/.claude/plugins/cache/…` or Codex's equivalent). In consumer mode plugin fixes are an override plus a proposal.
- **Never commit, push, tag, or `/release`** from this skill, and never file an upstream issue without an explicit go. Plugin-checkout edits need a go on that specific diff.
- **Never install a skill without explicit in-session approval.**

## Quality gate

For each proposal and each prune item, all four must be yes:

- Did you read the target file (not paraphrase it)?
- Is the evidence specific (timestamps, quotes, `file:line`, a command's output)?
- For additions: did you run the coverage audit? For deletions: did you verify the reason on the machine (the reference is really gone, the guard really exists, the decision really superseded it)?
- If the rule exists already: do you know whether it has been violated since it was introduced?

If any answer is soft, sharpen or drop.
