# Draft — a reply for a person to send (`/helpdesk draft <id>`)

## Steps

1. `helpdesk_ticket` for the whole thread.
2. **House voice.** Take the tone from the profile's `## Tone`. On Pylon, `helpdesk_lookups` with `kind: macros` lists the team's canned replies; start from the closest one and adapt it.
3. **Write it.** Answer the customer's latest question first, in the ticket's language. Promise nothing the profile and the thread don't support: no fix dates, no refunds, no features. Org rules decide what never appears in text a team or customer sees.
4. **Show it** in chat, beside the customer's last message, and ask for changes.
5. **Leave it.** Once the operator approves the text, and only if `helpdesk_note` is granted, post it with `helpdesk_note` as a private note: a person edits and sends it from the helpdesk. Without the grant, the chat draft is the deliverable.

## Output

The draft, then either the note's id or "draft in chat; paste it into the reply".
