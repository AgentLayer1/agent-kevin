# Account — one customer's tickets (`/helpdesk account <name>`)

Accounts are customer companies, which Pylon has and SupportCandy doesn't.

## Steps

1. `helpdesk_accounts` with `search: "<name>"`, and the profile's `helpdesk` and `connection`. Several matches: list them (name and domains) and ask which. None: say so.
2. `helpdesk_tickets` with `account: "<id>"` and `since: "any"`. Use the profile's `statuses` for "what's open", none for "everything", or the window the operator named.
3. Summarise one line per ticket (number, subject, status, last activity), open ones first, then any pattern across them.

On SupportCandy, say it has no accounts and offer `helpdesk_tickets` with `search: "<name>"` instead, which matches ticket text.

## Output

The list in chat, nothing saved.
