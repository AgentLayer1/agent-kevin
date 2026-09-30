# Day — what today should achieve (`/goals day`)

One to three outcomes for today: what should be true by tonight, not the task list. The focus skill's [plan](../../../focus/references/playbooks/plan.md) playbook picks the tasks and ranks the ones that serve these first; the evening brief scores them.

## Set the day

1. **Read what's already set.** In `<HOME>/projects/TASKS.md`, inside the `<!-- GOALS:START -->…<!-- GOALS:END -->` markers, read `## Daily Goals`, `## Weekly Goals` and `## Monthly Goals`. A Daily Goals heading dated today means today is already set: show it and ask whether to revise before going on.
2. Call `focus_write` with no arguments for `today` (the date every step below uses), today's lane, the carried-over lane, the week lane and `dueUnplanned`.
3. **Propose one to three outcomes**, each a finished state ("the invoice export is on staging"), never an activity ("work on the export"). Draw them from, in order: anything due today or overdue, the weekly goals, carried-over work, then today's lane. Each names the task it rests on when there is one, and its reason in a clause.
4. Confirm with one multi-select `AskUserQuestion`. The operator's own wording (the "Other" answer) wins over the proposal.
5. **Write the Daily Goals block.** Replace only the `## Daily Goals` section inside the markers, from its heading up to (not including) the next `##` heading or `<!-- GOALS:END -->`. When it's missing, add it as the first section after `<!-- GOALS:START -->`. Leave the other goal blocks and everything outside the markers untouched. A TASKS.md with no markers gets them from one `focus_write` call first; a block written outside them is erased on the next rebuild.

   ```markdown
   ## Daily Goals — <YYYY-MM-DD>

   1. <the outcome> (<task id>)
   2. …
   ```

6. Call `focus_write` with no arguments again, so the dashboard shows the goals just written.
7. Reply with the goals. When today's focus lane is empty, end with "Pick the tasks: `/focus plan`".

No report and no cadence stamp: the dated heading is the record, and yesterday's block is replaced tomorrow.

## Score the day (the evening brief, or "how did today go")

Score each goal under the `## Daily Goals` heading dated the day being wrapped (today, or yesterday before 3am, as the evening brief sets it): ✅ met, 🟡 partly, or ❌ missed, with one clause of why for every miss. Any other date scores nothing; say "no goals set today". Don't rewrite the block; the evening brief carries the score.
