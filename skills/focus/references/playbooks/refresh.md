# Refresh — pull the queue and re-render (`/focus [project]`)

The default playbook. It pulls what's waiting on the operator, re-renders the view, and replies with a card.

1. **First run?** A project page that doesn't exist yet is created by the first `focus_write`. On the first home refresh with Slack connected, offer [backfill](backfill.md); otherwise end the first reply with an offer to run `/focus plan`.
2. **My PRs.** Call `github_pr_list` with `author: <login>` and `limit: 50`. For each PR, write one queue item:
   - `title`: `#<number> <title>`; `url`: the PR url.
   - `detail`: review state, mergeability, and age, in plain words: `approved · clean · 2d`, `changes requested · 5d`, `draft · conflicts with main`.
   - `tone`: `good` when approved, mergeable and not a draft; `bad` on conflicts or changes requested; `dim` for drafts; `warn` otherwise.
3. **Reviews I owe.** Call `github_pr_list` with `reviewRequested: <login>`. The detail is the author and how long it has waited. Tone is `warn`, or `bad` once it has waited more than 3 days.
4. **Replies I owe** (Slack connected only). `slack_search` for mentions of the operator over the last 14 days (`<@ID>`, the id from `slack_whoami`). For each candidate that asks something (a question, a request, a review ask), open it with `slack_thread` and keep it only if the operator has not replied after it. The title names who asked and what, in one line. The detail is the channel and age. Tone is `bad` past 3 days, otherwise `warn`. Never quote a customer's personal data; ids are enough.
5. **A source you can't read stays visible.** If GitHub isn't configured, or Slack tools exist but error, don't send an empty list, which the page would render as "None open". Set the group's `unavailable` note instead, once, in a few words: what couldn't be read and why (`GitHub can't read 4 repos: web, ops, … (token can't resolve them)`, `Slack not connected: run /agent-kevin:configure-skills`). The page shows it under the group and never counts it as an item; send whatever items you could read alongside it.
6. Call `focus_write` with `queue` as groups in this order, each `{ label, empty, items, unavailable }`: `My pull requests` (empty: `None open.`), `Reviews I owe` (`Nothing waiting on you.`), and with Slack connected `Replies I owe` (`Inbox clear.`).
   **A project page** narrows each source to what the project's README names: its repo (`repo` on `github_pr_list`) and, with Slack connected, its Slack channels (`in:#channel` in the search). Leave out a source the README doesn't name rather than sending it empty; with none named, send `queue: []` and the page drops its Queue section.
7. **Reply with a card**, then the path `focus_write` returned, last:

```
🎯 Mon 28 Sep · W40 · <project, on a project page>
TODAY      1 <title> (id)   2 …   3 …
CARRIED    <n>, oldest from <day>
DUE        <n> due with no plan (only when there are any)
ROADMAP    <chip> <title> (slipped | now) · …, and "<n> with no task" when any
WEEK       <done>/<total> · <goal 1> · <goal 2>
QUEUE      <n> per group, e.g. 3 PRs (1 ready) · 2 reviews owed · 0 replies owed (the last with Slack only)
→ file://<path>
```

If Today is empty, end with a one-line offer to run `/focus plan`.
