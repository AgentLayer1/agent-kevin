# Add — turn an ask into a planned task (`/focus add <text | link>`)

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
