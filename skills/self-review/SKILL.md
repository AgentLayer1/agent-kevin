---
name: self-review
description: Interactive maintenance pass over the agent's own instructions and memory, run with the operator. Prunes first (stale memory, rules the model or a guard now covers, dead references, duplicated learnings), then turns accumulated feedback into prompt, skill, or code-plan changes, and promotes generic fixes and every generic rule the home has that the templates lack to the plugin (edited in place for a local checkout, written up as an upstream proposal for a marketplace install). Pass --full to reconsider all feedback regardless of the watermark. Triggers on "run a self-review", "review your own instructions", "prune your memory", or /self-review.
---

# Self-Review

Keep the agent's context lean and correct, and close the feedback loop, with the operator in the room.

## Core principles

**Subtract before you add.** Everything loaded at session start is paid for on every turn, and stale text does worse than cost tokens: an outdated fact gets acted on, a superseded rule fights its replacement, a rule the model already follows buries the ones it doesn't. Every cycle runs the prune pass first. A line earns its place only if deleting it would change behavior.

**The operator drives, the agent surfaces.** Read the evidence, name the patterns, propose specific edits and deletions. The operator picks. Edits happen in this session. No pending files, no async approval.

**One good change beats five tepid ones.** If the signal is weak, say so and stop.

**Depth over breadth.** A rule that was added and then violated *again* is worth ten new themes. Trace recurrence; don't just count instances.

## Start

1. Match the ask to a playbook below, open it, and copy its steps into your todo list. A step you skip stays in the list as `skip: <reason>`. A bare `/self-review` runs the rules pass.
2. The core principles above, and the hard rules and quality gate below, apply to every playbook.

## Playbooks

| Ask | Playbook |
|---|---|
| "run a self-review", "review your own instructions", "prune your memory", `/self-review`, `/self-review rules`, `--full` | [rules](references/playbooks/rules.md) |

## Hard rules

- **Never edit `IDENTITY.md`'s preamble or `## Who`.** Its `## Operational Pattern` changes only as a Track A proposal the operator approves.
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

Then the durability test for anything that adds text (applied to Track A, D, and E alike):

- **Durable:** still true in six months, once paths, SHAs, versions, and code shapes have changed.
- **Specific:** a future agent recognizes when it applies; neither a platitude ("write good code") nor a one-off fact.
- **Decision-changing:** a future agent does something different because of it, not just reads more text.
- **Not already covered:** you read the target first; a buried rule gets a placement fix, not a duplicate.
- **Not better as a mechanism:** if a test, lint, hook, or script could enforce it cheaply, that is the proposal (Track B), and the prose is the fallback.

If any answer is soft, sharpen or drop.
