# Hand off — a task becomes a GitHub issue the team works (`/project handoff <id>`)

A task whose work moves to the wider team is handed off to a GitHub issue on the project's repo, where the team discusses and closes it. The task stays open with the issue's URL in its `issue` field, and sync offers to close it once the issue closes.

## Where it goes

The project's `README.md` frontmatter names the repo, and optionally the labels every hand-off carries:

```yaml
issues_repo: acme/widgets
issue_labels: [triage]
```

An optional `## Issues` section in the README holds anything else the team's issues need: a template, labels by task type, terms that never go on an issue.

## Steps

1. **Read the task.** `task_get <id>`. A `done` or `cancelled` task isn't handed off; say so and stop. A task whose `issue` is already set has been handed off: offer a comment on that issue with what's new (`github_issue_comment`), never a second issue.
2. **Find the repo.** Read `issues_repo` and `issue_labels` from the project README's frontmatter, and its `## Issues` section when there is one. With no `issues_repo`, ask which repo, and offer to add the keys to the README so the next hand-off doesn't ask.
3. **Look for it first.** `github_issue_list` with that `repo`, `state: open` and `limit: 100`, then read the titles for the same work (the tool can't search). A match: offer to link the task to that issue (step 6) and to add a comment carrying what the task knows that the issue doesn't.
4. **Draft it for someone without this home, and show it.**
   - **Title:** what changes or what breaks, in the team's words. No task id.
   - **Body:** the what and the why from the Description; the Checklist as a GitHub task list (`- [ ]`, checked items kept checked); links to public material only (the repo's code, docs, other issues, PRs).
   - **Labels:** `issue_labels`, plus any the `## Issues` section gives the task's type. Labels must already exist in the repo.
   - **Never on the issue:** the task's Thread, paths inside this home (`projects/…`, `reports/…`, `knowledge/…`), wikilinks, memory, names of other projects, clients or employers, people's personal details, and money. Before showing the draft, check it against the boundary rules in `knowledge/memory/index.md` → `## Learnings` and any never-list in the README's `## Issues` section, and grep it for the private terms in this session and this project. Cut anything private rather than disguising it.

   Show the repo, title, labels and body together.
5. **Open it on a yes** to that exact draft: `github_issue_create` with `repo`, `title`, `body` and `labels`. If the call fails for lack of access, relay the tool's error and stop: the repo's token or `gh` login is the operator's to fix.
6. **Record the hand-off.**
   - `task_update <id>` with `issue: <the issue's URL>`. Status, priority and horizon stay as they are.
   - `task_thread <id>` with an `info` entry: `Handed off to <owner/repo>#<n> (<url>). The issue is the record from here.`

## Output

The issue's URL, the task id it's linked to, and the labels it went out with. If you linked to an existing issue instead of opening one, say so.
