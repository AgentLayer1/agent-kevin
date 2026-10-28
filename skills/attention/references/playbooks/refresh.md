# Refresh — pull the queue and re-render (`/attention [project]`)

The default playbook. It pulls what's waiting on the operator, re-renders the view, and replies with a card.

1. **First run?** A project page that doesn't exist yet is created by the first `attention_write`. On the first home refresh with Slack connected, offer [backfill](backfill.md); otherwise end the first reply with an offer to run `/attention plan`.
2. **My PRs.** Call `github_pr_list` with `author: <login>` and `limit: 50`. For each PR, write one queue item:
   - `title`: `#<number> <title>`; `url`: the PR url.
   - `detail`: review state, mergeability, and age, in plain words: `approved · clean · 2d`, `changes requested · 5d`, `draft · conflicts with main`.
   - `tone`: `good` when approved, mergeable and not a draft; `bad` on conflicts or changes requested; `dim` for drafts; `warn` otherwise.
3. **Reviews I owe.** Call `github_pr_list` with `reviewRequested: <login>`. The detail is the author and how long it has waited. Tone is `warn`, or `bad` once it has waited more than 3 days.
4. **Slack** (connected only). Call `slack_waiting` once, with `channels` set to the channels listed under the external sections of `<HOME>/knowledge/concepts/slack-channels.md` (the [slack](../../../slack/SKILL.md) skill names them; omit `channels` when there are none) and its defaults (`since: 7d`, `after: 60`). Keep every item it returns and add none; it returns no message text. Each item becomes one queue item: `title` `<from> in #<channel>`, `url` its `url`, `detail` the wait in plain words (`waiting 2h 10m`, `3 replies` when it has any), tone `bad` past a day, otherwise `warn`.
   - **Replies I owe** ← `mentions`: threads that mention the operator, unanswered by them for an hour. A bare tag counts; someone pulling the operator in is the ask.
   - **External threads waiting** ← `external`: threads whose last word is from someone outside the workspace (another organization in a shared channel, or a guest), an hour or more old, with no reply or reaction from us. A bot's auto-acknowledgement is not a reply.
   - A project page passes only the project's channels and keeps only the mentions in them.
   - A name under `missing` or `unreadable` goes in the group's `unavailable` note (`can't read #team-acme`), beside the items, and so does `more` (`Slack read stopped at its limit; the list may be short`).
   - `unmapped` goes in the `External threads waiting` note too (`3 channels not in the channel map: #a, #b, #c`), and an `unmapped` of `null` as `no channel map yet: run /agent-kevin:slack`. Neither counts as an item: a channel the map doesn't list is never scanned, so it has to be seen.
5. **A source you can't read stays visible.** If GitHub isn't configured, or Slack tools exist but error, don't send an empty list, which the page would render as "None open". Set the group's `unavailable` note instead, once, in a few words: what couldn't be read and why (`GitHub can't read 4 repos: web, ops, … (token can't resolve them)`, `Slack not connected: run /agent-kevin:configure-skills`). The page shows it under the group and never counts it as an item; send whatever items you could read alongside it.
6. Call `attention_write` with `queue` as groups in this order, each `{ label, empty, items, unavailable }`: `My pull requests` (empty: `None open.`), `Reviews I owe` (`Nothing waiting on you.`), and with Slack connected `Replies I owe` (`Inbox clear.`) and `External threads waiting` (`Nothing from outside waiting over an hour.`).
   **A project page** narrows each source to what the project's README names: its repo (`repo` on `github_pr_list`) and, with Slack connected, its Slack channels (step 4). Leave out a source the README doesn't name rather than sending it empty; with none named, send `queue: []` and the page drops its Queue section.
7. **Reply with a card**, then the path `attention_write` returned, last:

```
🎯 Mon 28 Sep · W40 · <project, on a project page>
TODAY      1 <title> (id)   2 …   3 …
CARRIED    <n>, oldest from <day>
DUE        <n> due with no plan (only when there are any)
ROADMAP    <chip> <title> (slipped | now) · …, and "<n> with no task" when any
WEEK       <done>/<total> · <goal 1> · <goal 2>
QUEUE      <n> per group, e.g. 3 PRs (1 ready) · 2 reviews owed · 0 replies owed · 4 external waiting (the last two with Slack only)
→ file://<path>
```

If Today is empty, end with a one-line offer to run `/attention plan`.
