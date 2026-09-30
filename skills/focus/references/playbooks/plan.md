# Plan — cut today to three (`/focus plan [project]`)

Run this in the morning. When the operator is overwhelmed, [organize](organize.md) runs first and calls this. Today holds three things at most: a longer list is a backlog, not a plan.

1. Call `focus_write` (no queue, and `project` on a project page) for the lanes. If the last queue pull is older than 12 hours, run [refresh](refresh.md) first.
2. **Read what's already in motion.** Open the newest radar report (`<HOME>/reports/radar/*-where-am-i.md`, the one the [where-am-i](where-am-i.md) playbook writes). A session that ends by asking the operator something, or stopped mid-flight on a task, is started work. When the newest radar is more than a day old, skip this step rather than reading stale sessions.
3. **Candidates for today**, in this order:
   1. carried-over work;
   2. anything due today or overdue: `focus_write` returns the ones with no plan as `dueUnplanned`, and `task_scan` has the rest;
   3. started work from step 2, above anything new;
   4. replies owed for more than 2 days (Slack connected);
   5. tasks linked to a slipped or in-flight roadmap milestone, slipped first;
   6. P0/P1 tasks in the week lane;
   7. reviews that have waited longest.
   Finishable-shaped items beat themes. Work the operator already started beats starting something new. When `focus_write` returns `dayGoals` (today's goals, set by the goals skill's [day](../../../goals/references/playbooks/day.md) playbook), a candidate that moves one of them ranks above the rest of its tier.
4. **Propose three**, each with a one-line reason tied to the evidence ("#42 has waited 4 days and unblocks the invoice export"). Confirm them with a multi-select `AskUserQuestion`.
5. **Settle each carried item** that wasn't picked: `This week`, `Later`, `Drop` (cancel the task), or `Keep carried`. Ask these in batches of four.
6. **Roadmap gaps.** For each slipped or in-flight milestone with no open task behind it, offer to create one through the [add](add.md) flow (one confirming question, horizon first). Skip the ones the operator waves off.
7. Apply the answers with `task_update` (`horizon: today` for the picks), then reply with the refresh card.
