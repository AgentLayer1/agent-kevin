You are updating the `## Learnings` section of Kevin's memory index at
`{{memoryIndexPath}}`. The memory index is loaded into every session, so
Learnings becomes hot context that helps Kevin self-correct in real time — NOT
a formal change log.

## Current memory index

```markdown
{{memoryIndex}}
```

## Current feedback log

{{feedback}}

## Your task

Use the Edit tool to replace the `## Learnings` section of `{{memoryIndexPath}}`
with a fresh synthesis, or add the section (after `## Key Context`, before any
trailing content) if it doesn't exist yet.

**Rules:**

1. **Preserve every other section verbatim.** Active Threads, Recent Decisions,
   Pending, Key Context, and the YAML frontmatter stay exactly as they are.
   Only touch the `## Learnings` section.
2. **Keep it lean.** 5–12 bullets max. Memory index must stay under 150 lines.
3. **Each bullet is one observed theme** with inline evidence. Format:
   `- **<theme name>.** <one-line description>. Evidence: <N> <kind(s)>
   across <dates>.`
4. **Only include themes with real signal** — 2+ independent feedback entries,
   across distinct days. Weak or one-off signals get dropped.
5. **Facts only, no proposals.** Don't say "should change X to Y" — just name
   the pattern. The interactive self-review skill is where proposals happen.
6. **Update frontmatter** `updated: {{now}}`.

**Example of what a good Learnings section looks like:**

```markdown
## Learnings

_Synthesised from [raw/user/feedback.md](../raw/user/feedback.md). Source of truth for feedback-driven self-correction._

- **Replies drift long.** Evidence: 4 corrections across Apr 3–Apr 15, all on responses >5 lines.
- **Scope creep on bug fixes.** Evidence: 3 corrections across Apr 8–Apr 14 — "just fix the bug, don't refactor".
- **Steps-not-tradeoffs preferred.** Evidence: 2 corrections on Apr 10, 12 — "tell me what to do, not the options".
```

Keep Kevin grounded in what the user has actually told him. No speculation.
