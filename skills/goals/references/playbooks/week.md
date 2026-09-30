# Week — set it on Monday, score it on Friday (`/goals week`)

The week gets set and scored in one place, so the week's tasks and the Weekly Goals in `TASKS.md` are the same list. The focus skill's [standup](../../../focus/references/playbooks/standup.md) playbook runs the quick set on Monday and the score on Friday; `/goals week` sets the week, except on a Friday or when asked to score it, when it [scores it](#score-the-week-friday-or-score-the-week); "plan the week" sets it any day. `/goals week interview`, "set my weekly goals", or sync's weekly nudge runs the [interview](#set-the-week-in-depth-the-interview) instead. Either one stamps the week, so a Monday standup that set it clears the nudge.

## Set the week (Monday, or "plan the week")

1. Call `focus_write` with no arguments for the lanes, the roadmap, and `planned.week`.
2. **Propose two or three week goals**, starting from the roadmap milestones `focus_write` returns under `roadmap` (slipped first), then the carried-over lane, the week lane, the Weekly Goals already in `TASKS.md`, and the work already in flight. Each goal names its task and what done looks like.
3. Confirm with one multi-select `AskUserQuestion`.
4. [Apply the week](#apply-the-week) with the chosen goals.
5. In a standup, add `## This week` above `Next`, one line per goal: **the deliverable**, what done means. Otherwise reply with the goals and the refresh card's WEEK line.

## Set the week in depth (the interview)

A short, decisive weekly plan. Aim for 3-5 goals, not 15. Quality of focus beats volume.

### Inputs

1. **Wins last 7 days** — tasks with `closed:` in the last week, commits to knowledge + projects.
2. **Full task board** — `mcp__plugin_agent-kevin_kevin__task_query` across **all** statuses and priorities, not just active + P0/P1. Blocked, stale, and P2/P3 items are interview material: they reveal drift, avoidance, and forgotten commitments.
3. **Stale / overdue** — `mcp__plugin_agent-kevin_kevin__task_scan`.
4. **Active threads + pending** — `<HOME>/knowledge/memory/index.md`.
5. **Last few sessions** — read the most recent 3-5 daily memory files (`<HOME>/knowledge/memory/YYYY-MM-DD.md`) and skim this week's `<HOME>/knowledge/raw/sessions/` day files. What actually consumed attention often diverges from what the task board claims — that gap is where the sharpest interview questions live.

### Interview

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

### Compose

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

If the user confirms, [apply the week](#apply-the-week) with the goals. Carry the "In flight" and "Explicitly NOT this week" lines into the snapshot body, not the block. Surface `📄 Saved to <path>` (the absolute `path` the tool returns, not `relPath` — so it's command-clickable in any terminal) to the operator alongside the TASKS.md update. A skipped or aborted interview writes nothing and leaves the watermark untouched, so the cadence stays due.

### Anti-patterns

- ❌ More than 5 goals. If you can't pick, you're not deciding.
- ❌ Vague goals like "make progress on X". Every goal is a concrete deliverable.
- ❌ Carrying everything in-flight as a goal. Some of it should be deferred or closed.
- ❌ Skipping the Interview step and drafting straight from context. Context shows what's on the board; only the operator knows what they actually want to push this week.
- ❌ Stopping after one polite round. If no answer surprised you, you didn't grill — round 2 exists to challenge, not confirm.
- ❌ Generic questions ("what are your priorities?"). Ask sharp, context-anchored questions or don't ask.

## Score the week (Friday, or "score the week")

1. Score every task `focus_write` returns under `planned.week` (planned for the week or one of its days, archived ones included): ✅ done, 🟡 partial (active, moved), or ❌ missed, with one clause of why for every miss.
2. Ask where each open one goes: next week (`horizon: next-week`), later, or dropped (cancel it). Apply the answers with `task_update`.
3. In a standup, add `## Week score` above `Next`; otherwise reply with the score. The misses are the useful part, because they show where the week was overcommitted or stuck; say them plainly.

Skip the week frame on a quiet week the operator says doesn't need one.

## Apply the week

One procedure, so the week's tasks and `TASKS.md` never drift apart:

1. **Plan the tasks.** `task_update` each goal's task to `horizon: week`. A goal with no task yet goes through the focus skill's [add](../../../focus/references/playbooks/add.md) flow first (one confirming question), then gets the same horizon.
2. **Write the Weekly Goals block.** In `<HOME>/projects/TASKS.md`, replace only the `## Weekly Goals` block inside the `<!-- GOALS:START -->…<!-- GOALS:END -->` markers: from `## Weekly Goals` up to (not including) the next `##` heading or `<!-- GOALS:END -->`. Leave the other goal blocks and everything outside the markers untouched; the task sections are rebuilt on every task change.

   ```markdown
   ## Weekly Goals — Week of <Monday, YYYY-MM-DD>

   1. <project>: <the deliverable> (<task id>) — <what done means>
   2. …
   ```

3. **Snapshot it**, so the week survives when `TASKS.md` is overwritten next week:

   ```
   report_write({
     category: 'briefings',
     slug: 'weekly-goals',
     title: <e.g. 'Weekly goals — Week of 2026-09-28'>,
     skill: 'goals',
     body: <the goals block, plus what carried over and what was deferred, as shown to the operator>,
     status: 'draft'
   });
   ```

4. **Stamp the cadence** so sync stops nudging for weekly goals until next week, only after the goals are written:

   ```bash
   bun "${CLAUDE_PLUGIN_ROOT}/skills/sync/scripts/watermark.ts" goals-week "<YYYY-MM-DD>"
   ```
