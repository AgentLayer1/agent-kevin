# Raise — a ticket becomes a bug, a feature or a task (`/helpdesk raise <id>`)

A ticket that needs work beyond a reply is raised as one of three kinds. The profile's `## Raising` says where each goes: a task in one of the home's projects, a card on a GitHub repo with the labels it names, or nowhere. A kind it doesn't name goes where bugs go.

| Kind | The ticket says | Task type |
|---|---|---|
| bug | Something breaks: the product does what it shouldn't | `bug` |
| feature | The person asks for something the product doesn't do | `idea` |
| task | Nothing breaks and nothing new is asked: a change to make (wording, a help article, a default) | `task` |

`/helpdesk bug <id>` is this playbook with the kind already set to bug.

## Steps

1. **Read the ticket.** `helpdesk_ticket` (with the profile's `helpdesk` and `connection`) for the thread: what the person did or asks for, what happened, what they expected, and the app version and device. A log or screenshot comes down with `helpdesk_attachment`; read the log from its temp path for the lines that matter.
2. **Name the kind.** Propose bug, feature or task with a one-line reason and where the profile sends it, and let the operator confirm or change it. A kind the profile's `## Raising` or `## Triage` sends nowhere stops here, saying what the profile does with it instead. With no `## Raising` at all, ask where it goes, and offer [setup](setup.md) to record the answer.
3. **Look for it first.** A task: `task_query` in that project. A card: `github_issue_list` with `repo` from `## Raising`, `state: open` and `limit: 100`, then read the titles for the same work (the tool can't search). A match gets this ticket added instead of a duplicate, on a yes: `task_thread`, or `github_issue_comment` naming the ticket the way a card title does, with no contact details.
4. **Draft it and show it.** The title says what breaks (a bug), what they want (a feature) or what changes (a task), then `(ticket <id>)`, so the pulse can match the card to its ticket when it closes. The body carries the ticket's link and what the kind needs:
   - **Bug:** the repro steps, expected against actual, the version and device, and a short log excerpt in a fenced block.
   - **Feature:** the ask in the person's terms and what they are trying to do.
   - **Task:** what to change, from what to what, and where (a screen, a file, a help article).

   It never carries the customer's name, email or account details: the ticket link is how a person on the team reaches them. Show the screenshots and the log excerpt with the draft, and leave off any that show a name, an email or an account.
5. **Raise it on a yes**, in the lifecycle's first state (the profile's `## Bug lifecycle`, else the [default](../lifecycle.md), which starts at `triage`). A task: `task_create` in the profile's project with the kind's task type and the same body. A card: `github_issue_create` with that state's label plus any the profile gives the kind, and the screenshots or videos from step 1 as `attachments`.
6. **Leave a trail.** Offer a private note on the ticket (`helpdesk_note`) naming the task or card, so whoever reads the ticket next sees it is raised.

## From an App Store review

A review is raised the same way, with three differences:

- **The title** ends `(App Store review)` instead of a ticket id, so the pulse never looks for a ticket to answer when the card closes.
- **The body** quotes the review's title and text in a blockquote, with its rating, app version, storefront and date. It never carries the reviewer's nickname.
- **No trail and no reply.** There's no ticket to note, and nothing in the plugin replies to a review.

The duplicate check is the same: a matching card or task gets the review added as a comment instead of a second card. Several reviews of one break, with the tickets and cards around them, go through [reviews](reviews.md) instead, which gathers them into one card.

## Output

The kind, the task id or the card's URL, and whether the note was left.
