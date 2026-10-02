---
name: self-review
description: Monthly upkeep of the agent's brain and rules, with the operator. The brain pass finds decay (stale or dormant tasks, quiet projects, memory lines gone false, decisions worth keeping, outdated articles, old captures), asks about each with evidence and a recommendation, and applies the answers. The rules pass prunes the prompt surface, turns feedback into prompt, skill, or code-plan changes, and promotes generic rules to the plugin. Sync offers it when due. Triggers on "run a self-review", "clean up the brain", "what's gone stale", "prune your memory", "review your own instructions", or /self-review.
---

# Self-Review

Keep the agent's brain and context lean and correct, and close the feedback loop, with the operator in the room. Stale, wrong and crowded data costs as much as missing data: it gets acted on, and it buries what's live.

## Core principles

**Subtract before you add.** Everything loaded at session start is paid for on every turn, and stale text does worse than cost tokens: an outdated fact gets acted on, a superseded rule fights its replacement, a rule the model already follows buries the ones it doesn't. Every cycle runs the prune pass first. A line earns its place only if deleting it would change behavior.

**The operator drives, the agent surfaces.** Read the evidence, name the patterns, propose specific edits and deletions. The operator picks. Edits happen in this session. No pending files, no async approval.

**One good change beats five tepid ones.** If the signal is weak, say so and stop.

**Depth over breadth.** A rule that was added and then violated *again* is worth ten new themes. Trace recurrence; don't just count instances.

## Start

1. Match the ask to a playbook below, open it, and copy its steps into your todo list. A step you skip stays in the list as `skip: <reason>`. A bare `/self-review` runs the brain pass, then the rules pass, in one sitting.
2. The core principles above, and the hard rules and quality gate below, apply to every playbook.
3. Run **Begin** before the first playbook and **Finish** after the last, once per sitting.

## Playbooks

| Ask | Playbook |
|---|---|
| "clean up the brain", "what's gone stale", "prune my tasks", sync's monthly prompt, `/self-review brain` | [brain](references/playbooks/brain.md) |
| "review your own instructions", "turn my feedback into rules", `/self-review rules`, `--full` | [rules](references/playbooks/rules.md) |
| "run a self-review", "prune your memory", `/self-review` | [brain](references/playbooks/brain.md), then [rules](references/playbooks/rules.md) |

`/self-review help` (or "what can self-review do?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Begin

```bash
HOME_DIR="${KEVIN_HOME:-$PWD}"
[ -f "$HOME_DIR/SOUL.md" ] || echo "NOT_AN_AGENT_HOME: $HOME_DIR"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-<SKILL_BASE_DIR>/../..}"   # under Codex replace <SKILL_BASE_DIR> with this skill's base directory
bun "$PLUGIN_ROOT/skills/self-review/scripts/context-weight.ts" --home "$HOME_DIR"
```

`NOT_AN_AGENT_HOME` → stop and ask the operator to relaunch from the agent home.

`context-weight.ts` prints the **always-loaded stack per host**, with bytes per file and a total. The two stacks differ: Claude Code loads the bridge, everything it `@`-imports (recursively, prose only: an `@path` inside a fenced block or a code span is not an import, and a bare `@word` that names no file is a mention), and every `.md` under `.claude/rules/` without a `paths:` scope; Codex loads `AGENTS.md` natively and gets the identity stack (SOUL, IDENTITY, USER, the knowledge index, the memory index, the task dashboard) from the SessionStart hook, never the bridge or the rules. A non-zero exit means an import did not resolve: fix or report that before using the totals. Record both totals as this sitting's baseline, before either pass changes anything; Finish reports the deltas. A rules-file deletion is a Claude-only saving; say so.

## Finish

Re-run `context-weight.ts`, then persist one report for the sitting with `report_write({ category: 'briefings', slug: 'self-review', title: 'Self-review: <date> (<counts>)', skill: 'self-review', status: 'draft', body })`. The body opens with the context weight per host (Claude `<before>` → `<after>` bytes, Codex `<before>` → `<after>`), then the `## Brain` section from the brain pass and the summary from the rules pass, and quotes every deleted or rewritten line verbatim under `## Removed`. Surface `📄 Saved to <path>` using the absolute `path` the tool returns. Skip the report only when nothing was pruned or changed. Each playbook writes its own watermark keys; neither overwrites the other's.


## Hard rules

- **Never edit `IDENTITY.md`'s preamble or `## Who`.** Its `## Operational Pattern` changes only as a Track A proposal the operator approves.
- **`raw/user/feedback.md` is append-only.** The only write is a `graduated:` or `graduated-rule:` marker through `capture`. Never edit past entries.
- **In `memory/index.md`, never touch `## Learnings` or `## Open Questions`.** Compile regenerates both: use markers for Learnings, and fix an Open Question at its source. Other sections take approved deletions and rewrites only.
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

Then the durability test for anything that adds text (applied to Track A, D, and E alike):

- **Durable:** still true in six months, once paths, SHAs, versions, and code shapes have changed.
- **Specific:** a future agent recognizes when it applies; neither a platitude ("write good code") nor a one-off fact.
- **Decision-changing:** a future agent does something different because of it, not just reads more text.
- **Not already covered:** you read the target first; a buried rule gets a placement fix, not a duplicate.
- **Not better as a mechanism:** if a test, lint, hook, or script could enforce it cheaply, that is the proposal (Track B), and the prose is the fallback.

If any answer is soft, sharpen or drop.
