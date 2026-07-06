---
name: yearly-goals
description: Plan the year quarter by quarter — reads the full task board, projects, and goal history, then interviews you before drafting per-quarter outcomes. Run quarterly: mid-year it shapes the remaining quarters; in Q4 it drafts next year starting from Q1.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__report_write, AskUserQuestion, Read, Edit, Bash
---

# Yearly Goals

The longest planning horizon Kevin keeps. Quarters, not weeks: each quarter gets 1-3 outcomes with a falsifiable end-of-quarter check. Monthly themes ladder up into these; weekly goals ladder into monthly.

## Which quarters to plan

Anchor on today's date:

- **Q1-Q3 (Jan-Sep):** plan the *remaining* quarters of the current year. Past quarters are reviewed, not re-planned — run in June and you review Q1-Q2, then plan Q3 and Q4.
- **Q4 (Oct-Dec):** the current year is effectively committed; plan *next year* from Q1. Open with a one-paragraph review of how this year's quarters landed.

State the chosen window explicitly at the top of the interview so the operator can override it.

## Inputs

1. **Existing yearly goals** — the `## Yearly Goals` block in `<HOME>/projects/TASKS.md` (if any), plus the current `## Monthly Goals`.
2. **Full task board** — `mcp__plugin_agent-kevin_kevin__task_query` across **all** statuses and priorities. Long-blocked chains and the P3 graveyard reveal what a year keeps deferring.
3. **Project visions** — each `<HOME>/projects/<slug>/README.md`; yearly outcomes should trace to a project's reason for existing, not a task list.
4. **Memory** — `<HOME>/knowledge/memory/index.md` Active Threads + Recent Decisions for hard external dates (filings, renewals, school years) that pin quarters down.
5. **Your durable preferences** — `<HOME>/USER.md` (family-first framing matters most at this horizon).

## Interview

Yearly planning is the operator's strategic intent, not an extrapolation — run 2-3 rounds of `AskUserQuestion`, like [monthly-goals](../monthly-goals/SKILL.md) but at quarter altitude:

**Round 1 — orient.** Propose a one-line *theme for the year* (or confirm the existing one), surface the 3-6 candidate outcomes the board + projects suggest, and ask which quarters they belong to. Surface known immovable dates and ask what else is pinned (travel, school, filings).

**Round 2 — grill.** Per quarter: cap it (1-3 outcomes), force a falsifiable end-of-quarter check per outcome, and ask the capacity question — "Q3 currently claims X, Y, and Z alongside the day job; which one moves to Q4 or dies?" Ask the stop-doing question at year scale: what does this year consciously *not* attempt?

**Round 3 (if needed) — converge** when quarters are over-committed or a check won't be accepted.

## Output

Offer to update `<HOME>/projects/TASKS.md` — replace **only** the `## Yearly Goals` block inside the `<!-- GOALS:START -->...<!-- GOALS:END -->` markers (create the section after `## Monthly Goals` if it doesn't exist). Leave the other goal blocks and auto-generated sections alone. Don't auto-write; confirm first.

Format:

```markdown
## Yearly Goals

_<Year> theme: <one line> · planned <YYYY-MM-DD>_

- **Q3** — <outcome> _(check: <falsifiable end-of-quarter test>)_
- **Q3** — <outcome> _(check: ...)_
- **Q4** — <outcome> _(check: ...)_
```

Past quarters stay listed with a ✅/❌/↪ verdict instead of a check, so the year reads as a record, not just a plan.

After updating `TASKS.md`, **also persist a snapshot** via the
`mcp__plugin_agent-kevin_kevin__report_write` MCP tool so the year's plan
survives when `TASKS.md` is overwritten next quarter:

```
report_write({
  category: 'briefings',
  slug: 'yearly-goals',
  title: <e.g. 'Yearly goals — 2026 (Q3-Q4)'>,
  skill: 'yearly-goals',
  body: <the full per-quarter outcomes + year theme + past-quarter verdicts as shown to the user>,
  status: 'draft'
});
```

Surface `📄 Saved to <path>` (the absolute `path` the tool returns, not `relPath` — so it's command-clickable in any terminal) to the operator alongside the TASKS.md update.

## Stamp the cadence watermark

So `sync` knows yearly goals were just set and stops nudging until the next quarter, record today's date. Do this **only after the quarters are actually written** — a skipped or aborted interview must leave the watermark untouched so it stays due:

```bash
bun -e 'const fs=require("node:fs"),p=require("node:path");const h=process.env.KEVIN_HOME??process.cwd();const f=p.join(h,".kevin/cadence.json");let o={};try{o=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}o["yearly-goals"]="<YYYY-MM-DD>";fs.writeFileSync(f,JSON.stringify(o,null,2)+"\n")'
```

Substitute `<YYYY-MM-DD>` with today's date. Read-modify-write preserves the sibling skills' watermarks.

## Boundaries

- Quarters get outcomes, not task lists — if it fits in a week, it belongs in weekly goals.
- Don't invent outcomes the operator didn't agree to in the interview.
- Family and faith commitments outrank project ambition when quarters collide; surface the collision, let the operator choose.
