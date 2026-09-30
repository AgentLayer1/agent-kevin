# Organize — empty your head, then cut to a plan (`/focus organize [project]`)

For when the operator is overwhelmed or asks to get organized: too much in their head, and a board too noisy to trust. Their head comes first and the board second, so never open with the task list. Ask three rounds of questions at most, about six questions in all, and only about gaps that exist.

1. **Pre-read, silently.** Call `focus_write` (no queue) for the lanes, `dueUnplanned`, `dayGoals` and the roadmap, and `task_scan` for overdue, stale and blocked tasks. Read the goal blocks in `<HOME>/projects/TASKS.md`, and the newest radar report when it is under a day old ([plan](plan.md), step 2). Note the gaps: no week goals, overdue tasks, a slipped milestone with no task behind it. Don't show any of it yet.
2. **Brain dump.** Ask in plain chat, not `AskUserQuestion`, and stop for the answer: "What's on your mind? Dump all of it, unsorted: work, home, worries, things you promised someone. And is this week light, normal or heavy?"
3. **Sort the dump.** Split it into items and match each against `task_query` ([add](add.md), step 2). Each lands in one bucket:

   | Bucket | What happens |
   |---|---|
   | Tracked | An existing task: note its id, and offer a horizon only if it has none |
   | New task | Actionable and theirs: drafted as [add](add.md) step 3 does |
   | Waiting on someone | A task only when the operator has to chase it |
   | Worry or note | Not actionable now: captured in step 6 |

   Show the sort as a short table, then place the new tasks with add's batch step. Ask for a date on any item whose wording implies one ("before the trip", "end of the month").
4. **Fill the gaps from step 1**, only the ones present, most urgent first, four per `AskUserQuestion` call:
   - An overdue task: `New date`, `This week`, `Later`, `Drop` (cancel it).
   - No week goals: set them inline with the goals skill's [week](../../../goals/references/playbooks/week.md) quick set, one goal on a heavy week and up to three on a light one.
   - A slipped or in-flight milestone with no task: [plan](plan.md), step 6.
5. **Cut to three.** Run [plan](plan.md) steps 3 to 5 with the dump folded in: an item the operator raised ranks above a board item in the same tier, because it's what is actually on their mind. On a heavy week, propose fewer than three.
6. **Capture the rest**, so nothing has to stay in their head: one `capture` call (kind `inbox`, title `On my mind — <YYYY-MM-DD>`) with every worry and note, one line each, for the next compile to fold into memory.
7. **Save the run:**

   ```
   report_write({
     category: 'plans',
     slug: 'organize',
     title: <e.g. 'Organize — 14 things out of your head, today cut to three'>,
     skill: 'focus',
     body: <the sorted dump, the gaps and their answers, today's three, the week goals, and the parked list>,
     status: 'clean'
   });
   ```

8. **Reply with the card.** Parked is everything this run moved to later, dropped, or left out of the week, so what isn't happening is on paper too.

```
🧹 Organized · Thu 1 Oct · <light | normal | heavy> week
FIRST MOVE  <the one thing to start in the next 30 minutes>
TODAY       1 <title> (id)   2 …   3 …
WEEK        <goal> · <goal>
PARKED      <item> (later | dropped | not this week) · …
CAPTURED    <n> new tasks · <n> already tracked · <n> notes to the inbox
→ file://<report path>
```

When more than ten tasks are stale, end with a one-line offer to settle them another time. Doing it here would pile a second job onto an overwhelmed operator.
