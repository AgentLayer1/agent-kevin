---
name: focus
description: The operator's focus page — today (up to three), work carried over, this week's and this month's goals with progress, their open PRs and the reviews they owe — rendered to <HOME>/focus.html across every project, or to projects/<slug>/focus.html for one project; the home page is a dashboard surface, a project page links from its project card. Three modes. `/focus [project]` pulls the queue and re-renders. `/focus add <text | link>` turns a one-line ask, a pasted list, or a GitHub issue or PR link into a task with a horizon (today, week, month, later). `/focus plan [project]` picks today's three and settles what carried over. Use when the operator says "what should I work on", "what's on my plate", "I'm overwhelmed", "take this on", "add this to my list", "plan my day", "what do I owe people", pastes a link as something to do, or invokes /focus.
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

## Identity

Read `<HOME>/USER.md` for `**Name:**` and `**GitHub login:**`. If the GitHub login is missing, ask once and suggest adding it to USER.md.

## Mode: refresh (`/focus [project]`)

1. **First run?** If the page doesn't exist yet, the first `focus_write` creates it. End the first reply with an offer to run `/focus plan`.
2. **My PRs.** Call `github_pr_list` with `author: <login>` and `limit: 50`. For each PR, write one queue item:
   - `title`: `#<number> <title>`; `url`: the PR url.
   - `detail`: review state, mergeability, and age, in plain words: `approved · clean · 2d`, `changes requested · 5d`, `draft · conflicts with main`.
   - `tone`: `good` when approved, mergeable and not a draft; `bad` on conflicts or changes requested; `dim` for drafts; `warn` otherwise.
3. **Reviews I owe.** Call `github_pr_list` with `reviewRequested: <login>`. The detail is the author and how long it has waited. Tone is `warn`, or `bad` once it has waited more than 3 days.
4. **A source you can't read stays visible.** If the GitHub pack isn't configured or errors, don't send empty lists, which the page would render as "None open". Send one `dim` item in each group instead: title `GitHub not connected`, detail the error in a few words or `run /agent-kevin:configure-skills → GitHub`.
5. Call `focus_write` with `queue` as groups in this order, each `{ label, empty, items }`: `My pull requests` (empty: `None open.`), `Reviews I owe` (`Nothing waiting on you.`).
   **A project page** narrows GitHub to the repo the project's README names (`repo` on `github_pr_list`). A project whose README names no repo sends `queue: []`, and the page drops its Queue section.
6. **Reply with a card**, then the page path last:

```
🎯 Mon 28 Sep · W40 · <project, on a project page>
TODAY      1 <title> (id)   2 …   3 …
CARRIED    <n>, oldest from <day>
DUE        <n> due with no plan (only when there are any)
ROADMAP    <chip> <title> (slipped | now) · …, and "<n> with no task" when any
WEEK       <done>/<total> · <goal 1> · <goal 2>
QUEUE      <n> per group, e.g. 3 PRs (1 ready) · 2 reviews owed
→ file://<path>
```

If Today is empty, end with a one-line offer to run `/focus plan`.

## Mode: add (`/focus add <text | link>`)

1. **Read the source.** For a GitHub issue or PR link, read it with `github_issue_view` or `github_pr_view`. For plain text, use it as given. Several items at once (a pasted list) are handled as a batch (step 5).
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
   3. tasks linked to a slipped or in-flight roadmap milestone, slipped first;
   4. P0/P1 tasks in the week lane;
   5. reviews that have waited longest.
   Finishable-shaped items beat themes. The in-flight rule from the standup skill applies: work the operator already started beats starting something new.
3. **Propose three**, each with a one-line reason tied to the evidence ("#42 has waited 4 days and unblocks the invoice export"). Confirm them with a multi-select `AskUserQuestion`.
4. **Settle each carried item** that wasn't picked: `This week`, `Later`, `Drop` (cancel the task), or `Keep carried`. Ask these in batches of four.
5. **Roadmap gaps.** For each slipped or in-flight milestone with no open task behind it, offer to create one through the add flow (one confirming question, horizon first). Skip the ones the operator waves off.
6. Apply the answers with `task_update` (`horizon: today` for the picks), then reply with the card.

## Rules

- **Never create a task the operator didn't place.** Every intake ends in a confirmed answer.
- **The queue is a snapshot.** The page prints its age, so never describe an old queue as current.
- **Outward actions stay outward.** Focus reads GitHub. It never comments, reviews or merges. Acting on a PR is the operator's next step, not this skill's.
