---
name: weekly-goals
description: Set this week's goals — reads the full task board + recent sessions, then interviews you (2-3 rounds) before drafting. Writes the goals block in TASKS.md. Run on Sunday or Monday.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__task_create, AskUserQuestion, Read, Write, Edit, Glob, Bash
---

# Weekly Goals

A short, decisive weekly plan. Aim for 3-5 goals, not 15. Quality of focus beats volume.

## Inputs

1. **Wins last 7 days** — tasks with `closed:` in the last week, commits to knowledge + projects.
2. **Full task board** — `mcp__plugin_agent-kevin_kevin__task_query` across **all** statuses and priorities, not just active + P0/P1. Blocked, stale, and P2/P3 items are interview material: they reveal drift, avoidance, and forgotten commitments.
3. **Stale / overdue** — `mcp__plugin_agent-kevin_kevin__task_scan`.
4. **Active threads + pending** — `<HOME>/knowledge/memory/index.md`.
5. **Last few sessions** — read the most recent 3-5 daily memory files (`<HOME>/knowledge/memory/YYYY-MM-DD.md`) and skim this week's `<HOME>/knowledge/raw/sessions/` day files. What actually consumed attention often diverges from what the task board claims — that gap is where the sharpest interview questions live.

## Interview

Context alone misses what's in the operator's head. This is an **interview, not a single question round** — run 2-3 rounds of `AskUserQuestion` and don't draft until you can defend every goal with the operator's own answers. The job is to grill, kindly: surface contradictions between what they say and what the board + sessions show.

**Round 1 — ground truth.** Calibrate the frame:

- **Capacity check** — "How much real focus time do you have this week (light / normal / heavy)?" — calibrates how many goals to propose.
- **External constraints** — surface anything that looks like a hard deadline or commitment in context and confirm: "Is the <X> deadline real for this week, or can it slip?"
- **Energy direction** — present 2-4 candidate goals derived from the full board + recent sessions and ask which to anchor on (`multiSelect: true` when stacking is fine).

**Round 2 — grill.** Build questions from the answers + the gaps the inputs exposed. Push back, don't just collect:

- **Drift confrontation** — "Sessions this week went mostly to <X>, but the board says <Y> is P0. Which one is the real priority?"
- **Avoidance probe** — pick the oldest stale P1 and ask directly: "<task> has been untouched for N weeks. Commit it this week, demote it, or kill it?"
- **Overcommitment challenge** — if their picks exceed the stated capacity, say so and force a cut: "That's 6 goals on a light week. Which 3 survive?"
- **Deferral** — make the NOT-list explicit; deferral is a decision, not a leftover.

**Round 3 (if needed) — converge.** Only when round 2 surfaced a genuine fork (e.g. two goals competing for the same days). Otherwise stop asking and draft.

Skip questions whose answer is already obvious from context. One sharp question beats three generic ones — but one round is almost never enough.

## Compose

Output to the user as a draft, then offer to write it into `<HOME>/projects/TASKS.md`.

```
🎯 Week of <YYYY-MM-DD>

✅ Last week
  - <up to 5 bullets of what landed>

🔄 In flight (carrying over)
  - <project>: <task id> — <where it stands>

🚀 This week (3-5 goals max)
  1. <project>: <concrete deliverable + why this week>
  2. ...

🚫 Explicitly NOT this week
  - <projects/tasks I'm deferring on purpose>
```

## Persist

If the user confirms, edit `<HOME>/projects/TASKS.md` and **replace only the `## Weekly Goals` block inside the `<!-- GOALS:START -->...<!-- GOALS:END -->` markers**. Leave `## Monthly Goals` (also inside the markers) and everything outside the markers untouched — the task-list sections are auto-rebuilt by Kevin and will be overwritten on the next mutation.

Replace from `## Weekly Goals` up to (but not including) the next `##` heading or `<!-- GOALS:END -->` with:

```markdown
## Weekly Goals — Week of <YYYY-MM-DD>

<the "This week" block above>

_Set <YYYY-MM-DD>. Next review: <next Sunday>._
```

After updating `TASKS.md`, **also persist a snapshot** via the
`mcp__plugin_agent-kevin_kevin__report_write` MCP tool so this week's goals
survive when `TASKS.md` is overwritten next Sunday:

```
report_write({
  category: 'briefings',
  slug: 'weekly-goals',
  title: <e.g. 'Weekly goals — Week of 2026-05-25'>,
  skill: 'weekly-goals',
  body: <the full goals block + wins/in-flight/defer rationale as shown to the user>,
  status: 'draft'
});
```

Surface `📄 Saved to <relPath>` to the operator alongside the TASKS.md update.

## Anti-patterns

- ❌ More than 5 goals. If you can't pick, you're not deciding.
- ❌ Vague goals like "make progress on X". Every goal is a concrete deliverable.
- ❌ Carrying everything in-flight as a goal. Some of it should be deferred or closed.
- ❌ Skipping the Interview step and drafting straight from context. Context shows what's on the board; only the operator knows what they actually want to push this week.
- ❌ Stopping after one polite round. If no answer surprised you, you didn't grill — round 2 exists to challenge, not confirm.
- ❌ Generic questions ("what are your priorities?"). Ask sharp, context-anchored questions or don't ask.
