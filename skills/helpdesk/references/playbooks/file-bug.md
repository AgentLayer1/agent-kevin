# File a bug — a ticket becomes a task or a GitHub card (`/helpdesk bug <id>`)

The profile's `## Filing bugs` says where a bug goes: a task in one of the home's projects, or a card on a GitHub repo with the labels it names.

## Steps

1. **Gather the repro.** `helpdesk_ticket` for the thread: what the person did, what happened, what they expected, and the app version and device. A log or screenshot comes down with `helpdesk_attachment`; read the log from its temp path for the lines that matter.
2. **Look for it first.** A task: `task_query` in that project. A card: `github_issue_list` on the repo (open cards) for the same bug. A match gets this ticket added (`task_thread`, or `github_issue_comment` on the card) instead of a duplicate.
3. **Draft it and show it.** Title `<what breaks> (ticket <id>)`, so the pulse can match the card to its ticket when it closes. The body carries the ticket's link, the repro steps, expected against actual, the version and device, and a short log excerpt in a fenced block. It never carries the customer's name or email: the ticket link is how a person on the team reaches them.
4. **File it on a yes.** A task: `task_create` in the profile's project with the same body. A card: `github_issue_create` with the profile's labels, and the screenshots or videos from step 1 as `attachments`.
5. **Leave a trail.** Offer a private note on the ticket (`helpdesk_note`) naming the task or card, so whoever reads the ticket next sees it is filed.

## Output

The task id or the card's URL, and whether the note was left.
