---
name: focus
description: The operator's focus page — today (up to three), work carried over, this week's and this month's goals with progress, their open PRs, the reviews they owe and, when Slack is connected, the replies they owe — rendered to <HOME>/focus.html across every project, or to projects/<slug>/focus.html for one project; the home page is a dashboard surface, a project page links from its project card. Three modes. `/focus [project]` pulls the queue and re-renders. `/focus add <text | link>` turns a one-line ask, a pasted list, a GitHub link or a Slack link into a task with a horizon (today, week, month, later). `/focus plan [project]` picks today's three and settles what carried over. With Slack connected, the first run offers to backfill priorities posted there. Use when the operator says "what should I work on", "what's on my plate", "I'm overwhelmed", "take this on", "add this to my list", "plan my day", "what do I owe people", pastes a link as something to do, or invokes /focus.
allowed-tools: Read, Glob, AskUserQuestion, mcp__plugin_agent-kevin_kevin__focus_write, mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_create, mcp__plugin_agent-kevin_kevin__task_update, mcp__plugin_agent-kevin_kevin__task_get, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__github_pr_list, mcp__plugin_agent-kevin_kevin__github_pr_view, mcp__plugin_agent-kevin_kevin__github_issue_view
---

# focus — today, this week, this month

One page the operator can glance at in the morning, in standup, or when there's too much going on: what today is for, what slipped, what the week and month are for, and who is waiting on them. The page is derived. Tasks are the source of truth, and a task's `horizon` field says when it's planned:

| `horizon` | Lane |
|---|---|
| `2026-09-28` (a day) | Today on that day; Carried over once it has passed |
| `2026-W40` (an ISO week) | This week; Carried over after it |
| `2026-10` (a month) | This month; Carried over after it |
| `later` | Later |
| empty | Not planned |

Each page also carries what it shows as JSON, in a `<script type="application/json" id="focus-data">` block, so anything can read a focus page without rendering it. `focus_write` returns the same data (lanes, `planned`, `dueUnplanned`, `roadmap`, `snapshot`) with the page `path`.

Pass the shorthands `today`, `week`, `next-week`, `month` or `later` to `task_create` / `task_update`; the tool stores the period. Every task mutation re-renders each focus page that exists, so there is no separate save step. Week and month progress count every task planned inside the period, including ones since pulled into today and ones sync has archived.

## Scope

| Call | Page | Holds |
|---|---|---|
| `/focus` | `<HOME>/focus.html` | every project, plus the Weekly and Monthly Goals |
| `/focus <project>` | `<HOME>/projects/<project>/focus.html` | that project's tasks only |

**Roadmaps feed the page.** The home page reads `<HOME>/roadmap.html`. A project page reads its own `projects/<slug>/roadmap.html`, plus the root roadmap's milestones that name one of the project's task ids. The Roadmap section lists milestones that are slipped (their period ended with items open) or in flight (an item in progress, or their period covers today). It shows each one's linked tasks and flags a milestone no open task names. `focus_write` returns them under `roadmap`. A roadmap still on a script literal, or one with no dates, gets a one-line notice instead of silence.

A word after the mode that names a folder under `<HOME>/projects/` is the project (`/focus plan acme`); pass it as `project` on every `focus_write`. Each page keeps its own queue.

"Mine" means a task whose assignee is empty, `user`, the agent's name, or the operator's first name or GitHub login. Teammates' tasks stay off the page.

## Sources

GitHub is the queue's base. **Slack is optional:** it counts as connected when the session has Slack tools that identify the operator, search messages and read a thread, from any Slack MCP server the operator has added, and the identify call answers. Below, `slack_whoami`, `slack_search` and `slack_thread` stand for those three tools. Every Slack step below runs only then. With no Slack tools at all, skip those steps silently; with tools that error, say so (refresh, step 4).

## Identity

Read `<HOME>/USER.md` for `**Name:**` and `**GitHub login:**`. With Slack connected, its user id comes from `slack_whoami`. If the GitHub login is missing, ask once and suggest adding it to USER.md.

## Mode: refresh (`/focus [project]`)

1. **First run?** If the page doesn't exist yet, the first `focus_write` creates it. For the home page with Slack connected, offer the backfill below; otherwise end the first reply with an offer to run `/focus plan`.
2. **My PRs.** Call `github_pr_list` with `author: <login>` and `limit: 50`. For each PR, write one queue item:
   - `title`: `#<number> <title>`; `url`: the PR url.
   - `detail`: review state, mergeability, and age, in plain words: `approved · clean · 2d`, `changes requested · 5d`, `draft · conflicts with main`.
   - `tone`: `good` when approved, mergeable and not a draft; `bad` on conflicts or changes requested; `dim` for drafts; `warn` otherwise.
3. **Reviews I owe.** Call `github_pr_list` with `reviewRequested: <login>`. The detail is the author and how long it has waited. Tone is `warn`, or `bad` once it has waited more than 3 days.
4. **Replies I owe** (Slack connected only). `slack_search` for mentions of the operator over the last 14 days (`<@ID>`). For each candidate that asks something (a question, a request, a review ask), open it with `slack_thread` and keep it only if the operator has not replied after it. The title names who asked and what, in one line. The detail is the channel and age. Tone is `bad` past 3 days, otherwise `warn`. Never quote a customer's personal data; ids are enough.
5. **A source you can't read stays visible.** If GitHub isn't configured, or Slack tools exist but error, don't send an empty list, which the page would render as "Inbox clear". Send one `dim` item instead: title `Slack not connected` (or `GitHub not connected`), detail the error in a few words or `run /agent-kevin:configure-skills`.
6. Call `focus_write` with `queue` as groups in this order, each `{ label, empty, items }`: `My pull requests` (empty: `None open.`), `Reviews I owe` (`Nothing waiting on you.`), and with Slack connected `Replies I owe` (`Inbox clear.`).
   **A project page** narrows each source to what the project's README names: its repo (`repo` on `github_pr_list`) and, with Slack connected, its Slack channels (`in:#channel` in the search). Leave out a source the README doesn't name rather than sending it empty; with none named, send `queue: []` and the page drops its Queue section.
7. **Reply with a card**, then the page path last:

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

## Mode: add (`/focus add <text | link>`)

1. **Read the source.** For a GitHub issue or PR link, read it with `github_issue_view` or `github_pr_view`. For a Slack permalink (Slack connected), pull it with `slack_thread` (the channel id and ts are in the link: `/archives/<C…>/p<digits>`, and the ts is those digits with a dot before the last six). For plain text, use it as given. Several items at once (a pasted list, or a Slack message listing priorities) are handled as a batch (step 5).
2. **Check for an existing task.** Run `task_query` and look for the same work under another name. If one exists, offer to set its horizon (and link the new source in its thread) instead of creating a duplicate.
3. **Draft the task:**
   - `title`: finishable-shaped ("Reply to Jordan about the export date", not "Exports").
   - `project`: pick one from `<HOME>/projects/`.
   - `priority`: from what the source says about urgency; default P2.
   - `due`: only if the source names a date.
   - `description`: two or three sentences on what's being asked and by whom, plus the source link. No pasted threads, and no personal data beyond ids.
4. **Confirm with one question.** Ask with `AskUserQuestion`, horizon first: `Today`, `This week`, `This month`, `Later`. Put the drafted title, project and priority in the question text so a correction can go in "Other".
5. **Batches.** Ask one question per item, four per `AskUserQuestion` call, with options `This week`, `This month`, `Later`, `Skip`. Create only the items the operator placed.
6. Call `task_create` with `horizon` set. Reply in one line: the id, the title, and the lane it landed in.

## Mode: plan (`/focus plan [project]`)

Run this in the morning, or when the operator is overwhelmed. Today holds three things at most: a longer list is a backlog, not a plan.

1. Call `focus_write` (no queue, and `project` on a project page) for the lanes. If the last queue pull is older than 12 hours, run refresh first.
2. **Candidates for today**, in this order:
   1. carried-over work;
   2. anything due today or overdue: `focus_write` returns the ones with no plan as `dueUnplanned`, and `task_scan` has the rest;
   3. replies owed for more than 2 days (Slack connected);
   4. tasks linked to a slipped or in-flight roadmap milestone, slipped first;
   5. P0/P1 tasks in the week lane;
   6. reviews on money, security or compliance paths.
   Finishable-shaped items beat themes. The in-flight rule from the standup skill applies: work the operator already started beats starting something new.
3. **Propose three**, each with a one-line reason tied to the evidence ("#42 has waited 4 days and unblocks the invoice export"). Confirm them with a multi-select `AskUserQuestion`.
4. **Settle each carried item** that wasn't picked: `This week`, `Later`, `Drop` (cancel the task), or `Keep carried`. Ask these in batches of four.
5. **Roadmap gaps.** For each slipped or in-flight milestone with no open task behind it, offer to create one through the add flow (one confirming question, horizon first). Skip the ones the operator waves off.
6. Apply the answers with `task_update` (`horizon: today` for the picks), then reply with the card.

## First run: backfill from Slack

With Slack connected, offer this once, on the first refresh: "Want me to pull the priorities you and your leads have posted in Slack into tasks?"

1. Search for the operator's own priority posts and for lists others wrote for them. Try several phrasings: `priorities from:<@ID>`, `"this week" from:<@ID>`, `priorities <@ID>`, `to-dos <@ID>`, `goals for this week`. Open each hit with `slack_thread`, because the list is often updated in the replies.
2. Split each thread into items. Drop anything that's done (a later message, a merged PR, or a closed task says so), and dedupe across threads and against `task_query`.
3. Show the open items as a short table: the item, who asked, when it was first and last raised, and the matching task if any. Then triage them in batches (add mode, step 5). Items that match an existing task get a horizon, not a duplicate.

## Rules

- **Never create a task the operator didn't place.** Every intake ends in a confirmed answer.
- **The queue is a snapshot.** The page prints its age, so never describe an old queue as current.
- **Outward actions stay outward.** Focus reads GitHub, and Slack when it's connected. It never comments, reviews, reacts or replies. Drafting a reply is the operator's next step, not this skill's.
