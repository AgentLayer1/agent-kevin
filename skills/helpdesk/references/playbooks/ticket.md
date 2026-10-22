# Ticket — one ticket's story (`/helpdesk ticket <id>`)

## Steps

1. `helpdesk_ticket` with the id, and the profile's `helpdesk` and `connection`.
2. Summarise, in this order:
   - **The ask:** what the customer needs, in your words.
   - **What support said**, each reply in a line.
   - **Internal notes**, kept apart and marked internal; the customer never saw them.
   - **Who:** the customer (name, email, account) and the assignee, from the ticket and its message authors.
   - **Where it stands:** status, last activity, linked engineering issues, and what is still open.
   - **Attachments** by name. Fetch one with `helpdesk_attachment` only when the question needs its contents (a log to read, a screenshot to check), and read it from the temp path the tool returns.
3. Apply the profile: a triage rule that matches the ticket says so, and a ticket that needs a fix or a change gets the offer to raise it, the way [raise](raise.md) says.
4. On Pylon, a ticket with an `account` can lead into the [account](account.md) playbook; offer it when the operator asks what else that customer has open.

## Output

The summary above in chat, nothing saved.
