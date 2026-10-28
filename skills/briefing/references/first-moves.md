# First moves — how a briefing closes

Both briefings end with a short ranked list of what to do first, across everything: tasks, sessions,
pull requests, goals. The morning shows it as `👉 First moves`, the evening as `🌅 Tomorrow's first moves`.
It is the part the operator acts on, so it stays short and every item is a concrete action.

## Inputs

- **Tasks** — the `task_scan` and `task_query` results the brief already gathered: due today or tomorrow,
  overdue, blocked on the operator.
- **Sessions waiting on you** — open the newest report in `<HOME>/reports/radar/` (the one checkpoint all in
  the attention skill's [checkpoint](../../attention/references/playbooks/checkpoint.md) playbook writes). Its
  `★ **Waiting on you**` list holds the decisions sessions are idle on, each naming its session and the pick.
  For each entry you carry, take the resume line (`↳ claude --resume <id>`) from the card with the same title
  in the same report. When the newest radar is more than a day old, skip this input rather than reading stale
  sessions. Never re-scan sessions from the brief.
- **Owed to people** — the queue in the `attention_write` result's `snapshot` (pull requests, reviews and
  replies waiting on the operator). The evening brief calls `attention_write` with no arguments to get it.
- **Goals and lanes** — today's goals and attention's Today lane, already gathered.

## Rank

Three to five items, top first; one is fine on a quiet day.

1. A dated obligation due today or tomorrow, or a task blocked on the operator.
2. A session waiting on the operator (★): it sits idle until answered.
3. A pull request, review or reply owed, oldest first.
4. The rest: today's goals unset (`/goals day`), an empty Today lane (`/attention plan`), a stale call worth
   making.

Item 1 is the first move: the one concrete, blocked-on-nothing action to start with. Unset goals and an empty
Today lane rank fourth, so they lead only when nothing above them is waiting.

## Shape

```
👉 First moves
  1. <the first move>   ← start here
  2. ★ <question> → <the pick> · <session title>  ↳ `claude --resume <id>`
  3. `<task-id>` <title>, <why now: due tomorrow, blocked on you>
  4. Review <pull request title> (#<n>), owed <age>
```

- A ★ item keeps the radar's question and pick, and names its session. Several entries from one session become
  one item with one resume line.
- An item may point at a `🎯 Today` bullet ("finish `ac-101`, Today's first bullet") but never repeats one word
  for word.
- Nothing to rank (no task due, no ★, nothing owed, goals set): one line with the first move alone.
