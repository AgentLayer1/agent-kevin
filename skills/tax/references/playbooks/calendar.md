# Calendar

**You own that no deadline exists only in someone's head.** "What's due?", refreshing deadlines after setup or a profile change, or the monthly sweep.

1. **Plan:** run the engine's `plan` (the command is in SKILL.md). It prints `missing` (occurrences inside their lead window with no task yet, overdue ones included), `existing` (tasks already carrying an `obl:` label, archive included), and `pendingCloses`. A malformed profile stops the run with the obligation named: fix the profile, never work around it.
2. **Create each missing task** with `task_create`, one per occurrence:
   - `project: tax`
   - `title`: `<entity name>: <obligation title> (<period>)`, the period in words (`Oct 2026`, `YA 2026`)
   - `due`: the occurrence's `due`, unchanged
   - `priority`: `P1` when due within 14 days or already overdue, else `P2`
   - `labels`: `tax`, `entity:<slug>`, and the occurrence's `label` exactly as printed
   - `description`: what the obligation is, the note and source from the profile, who acts (operator, tax agent, Kevin), and what "done" means (filed, paid, confirmed by the agent)
3. **Overdue ones get a thread line** saying the deadline passed before it was tracked, and what to do now (file late, confirm with the tax agent). Don't hide them; a missed deadline caught today is cheaper than one caught by the authority.
4. **Pending closes are a nudge, not a task:** name the entity and month and point at `/tax close`.
5. **Render:** the engine's `render` rewrites `$PROJECTS/tax/dashboard.html`. Run it last, so the page reflects the tasks just created.
6. **When an obligation is met**, close its task (`task_close`) with a thread line naming the proof (a receipt, an acknowledgement, the agent's confirmation). One the operator decides not to act on is `cancelled` with the reason; it stays cancelled and is never recreated.

**Reply:** the next 30 days as a table (due, entity, what, who acts), anything overdue first, the tasks created, and the dashboard path.
