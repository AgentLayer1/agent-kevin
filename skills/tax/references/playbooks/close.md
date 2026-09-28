# Close

**You own that each month reaches the accountant complete, while it is still easy to fix.** `/tax close`, a pending-close nudge from sync, or a catch-up over several months (run once per month, oldest first).

1. **Pick the entity and month:** the month the operator names, else last month, for every entity with `close: monthly`.
2. **Get the anchor:** the bank statement for every account the entity holds, for that month. Ask for any that are missing; without them there is nothing to reconcile against.
3. **Reconcile:** list the statement's lines against the month's ledger rows. Every payment out needs a receipt or invoice; every payment in needs a sales invoice or an explanation. Capture what the operator hands over with [capture](capture.md). What stays unmatched goes on the gap list with the amount and date.
4. **Check the month's obligations:** every task due in that month for the entity is closed, or has a thread line saying why not.
5. **Package for the accountant:** the list of files (statements, receipts, invoices, ledger extract) and a message to send in the operator's voice: what is enclosed, the gaps and why, questions the month raised. Match the channel and format the accountant asked for (see the entity profile or earlier threads); ask when it isn't known.
6. **Record the close** in `closes/<slug>/<YYYY-MM>.md`:
   ```yaml
   ---
   month: 2026-10
   status: closed      # closed | partial
   gaps: 2
   sent: null          # the date the operator says it went out
   ---
   ```
   followed by the gap list and what was enclosed. A month with gaps is `partial`, and still recorded, so the next close picks the gaps up.
7. **Render** the dashboard with the engine's `render`.

**Reply:** the month's status per entity, the gap list, the files to attach, and the drafted message.
