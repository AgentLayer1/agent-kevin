---
title: Self-Evolution Loop
sources: [seeded by /agent-kevin:init]
created: {{INIT_DATE}}
updated: {{INIT_DATE}}
---

# Self-Evolution Loop

A feedback-driven mechanism for the agent to systematically improve its own behavior, with the user as the hard gate. The compiled half (feedback → Learnings in `memory/index.md`) is wired in; the prompt-diff half is an optional layer on top.

## Core Idea

AI assistants accumulate behavioral drift — the gap between what the user wants and what the assistant does. Corrections fix individual instances but don't compound. This pattern closes the loop: feedback is captured, compiled into themes, and surfaces as durable Learnings that load into every future session.

```
User Feedback (reactions, corrections, explicit instructions)
         ↓
Append-only feedback log (raw/user/feedback.md)
         ↓
Feedback Compilation (group by theme, identify patterns)
         ↓
memory/index.md → ## Learnings (loaded every session)
         ↓
(optional) Proposed prompt diffs → user approval → apply
```

## Feedback Sources

Four signal types, ordered by explicitness:

1. **Explicit instructions** — "always do X" / "never do Y again." Highest signal, lowest ambiguity.
2. **Corrections** — "No, that's wrong" / "don't do X." Requires pattern detection in conversation context.
3. **Negative reactions** — emoji on a chat surface (👎💩🤮😡🙁). Captured at the interface layer.
4. **Positive reactions** — (👍❤️🔥🎉). Logged the same way. Confirms non-obvious approaches that should be preserved — important because saving only corrections causes overcorrection and drift away from validated behaviors.

All feedback appends to `knowledge/raw/user/feedback.md`. The raw file is **append-only and never deleted** — it's the audit trail.

## Compilation Step

A dedicated compile pass reads `feedback.md` and produces actionable output:

- **Group by theme:** communication style, task quality, factual errors, preference mismatches
- **Identify patterns:** three corrections in the same direction are a pattern worth acting on; one is an anecdote
- **Output:** the `## Learnings` section of `knowledge/memory/index.md`, which is loaded into every session

The compiler distinguishes signal from noise. Each Learning includes a **Why:** (the reason the user gave) and a **How to apply:** (when the guidance kicks in). Knowing *why* lets the agent judge edge cases instead of blindly following the rule.

## Optional: Prompt Evolution

A periodic review (monthly or as-needed) reads compiled feedback themes against current personality and operational files (`SOUL.md`, `AGENTS.md`, skills). The agent proposes specific, minimal diffs — shown as before/after — for user approval. On approval, changes are committed with a `self-evolve:` prefix for traceability.

## Guardrails

The approval hierarchy prevents unchecked self-modification:

| File | Modification Rule |
|------|-------------------|
| `IDENTITY.md` (safety rules) | Never modified without explicit approval |
| `SOUL.md` (personality) | Requires approval; diffs shown before apply |
| `AGENTS.md` (operational rules) | Approval with lighter review |
| Skills and scheduled prompts | Lower friction; still approval-gated |

The agent can never bypass the approval gate. All proposed changes are shown as diffs, not applied silently.

## Why This Matters

Most AI tuning is reactive and ephemeral — the user corrects in-session, the correction applies to the current session, and the next session starts fresh. The self-evolution loop makes behavioral improvement **cumulative** across sessions. Each correction compounds into permanent configuration rather than evaporating at session end. The approval gate ensures the agent improves in the direction the user wants, not in the direction the agent infers.

## See Also

- [[concepts/karpathy-wiki]] — feedback compilation follows the same raw → compiled pattern as session knowledge
- [[concepts/audit-premise-decay]] — when a Learning ages out (the world changed), refute and replace rather than letting it ossify
