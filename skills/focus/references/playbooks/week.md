# Week — set it on Monday, score it on Friday (`/focus week`)

The week gets set and scored in one place, so the week's tasks and the Weekly Goals in `TASKS.md` are the same list. The [standup](standup.md) playbook runs this on Monday and Friday; "plan the week" or `/focus week` runs it any day. The weekly-goals skill ends in [Apply the week](#apply-the-week) too.

## Set the week (Monday, or "plan the week")

1. Call `focus_write` with no arguments for the lanes, the roadmap, and `planned.week`.
2. **Propose two or three week goals**, starting from the roadmap milestones `focus_write` returns under `roadmap` (slipped first), then the carried-over lane, the week lane, the Weekly Goals already in `TASKS.md`, and the work already in flight. Each goal names its task and what done looks like.
3. Confirm with one multi-select `AskUserQuestion`.
4. [Apply the week](#apply-the-week) with the chosen goals.
5. In a standup, add `## This week` above `Next`, one line per goal: **the deliverable**, what done means. Otherwise reply with the goals and the refresh card's WEEK line.

## Score the week (Friday, or "score the week")

1. Score every task `focus_write` returns under `planned.week` (planned for the week or one of its days, archived ones included): ✅ done, 🟡 partial (active, moved), or ❌ missed, with one clause of why for every miss.
2. Ask where each open one goes: next week (`horizon: next-week`), later, or dropped (cancel it). Apply the answers with `task_update`.
3. In a standup, add `## Week score` above `Next`; otherwise reply with the score. The misses are the useful part, because they show where the week was overcommitted or stuck; say them plainly.

Skip the week frame on a quiet week the operator says doesn't need one.

## Apply the week

One procedure, so the week's tasks and `TASKS.md` never drift apart:

1. **Plan the tasks.** `task_update` each goal's task to `horizon: week`. A goal with no task yet goes through the [add](add.md) flow first (one confirming question), then gets the same horizon.
2. **Write the Weekly Goals block.** In `<HOME>/projects/TASKS.md`, replace only the `## Weekly Goals` block inside the `<!-- GOALS:START -->…<!-- GOALS:END -->` markers: from `## Weekly Goals` up to (not including) the next `##` heading or `<!-- GOALS:END -->`. Leave `## Monthly Goals` and everything outside the markers untouched; the task sections are rebuilt on every task change.

   ```markdown
   ## Weekly Goals — Week of <Monday, YYYY-MM-DD>

   1. <project>: <the deliverable> (<task id>) — <what done means>
   2. …

   _Set <YYYY-MM-DD>. Next review: <Friday>._
   ```

3. **Snapshot it**, so the week survives when `TASKS.md` is overwritten next week:

   ```
   report_write({
     category: 'briefings',
     slug: 'weekly-goals',
     title: <e.g. 'Weekly goals — Week of 2026-09-28'>,
     skill: 'focus',  // 'weekly-goals' when that skill applies the week
     body: <the goals block, plus what carried over and what was deferred, as shown to the operator>,
     status: 'draft'
   });
   ```

4. **Stamp the cadence** so sync stops nudging for weekly goals until next week, only after the goals are written:

   ```bash
   bun "${CLAUDE_PLUGIN_ROOT}/skills/sync/scripts/watermark.ts" weekly-goals "<YYYY-MM-DD>"
   ```
