# Close

**You own that each month reaches the accountant complete, while it is still easy to fix.** `/tax close`, a pending-close nudge from sync, "what do I need to collect?", "what's missing for the books?", or a catch-up over several months (run once per month, oldest first).

1. **Start from the engine's `books`** (the command is in SKILL.md): per company, each month's state (booked, with the accountant, ready, gaps, collecting, not started) and the to-collect list (missing statements by account, open gaps, the accountant's open asks, profile holes). For "what do I need to collect?", that list is the answer: reply with it and stop.
2. **Pick the entity and month:** the month the operator names, else the oldest month the books show as not started, collecting or with gaps.
3. **Get the anchor:** the bank statement for every account under the profile's `## Accounts`, for that month; each one lands as a `statement` row through [capture](capture.md). Ask for any that are missing; without them there is nothing to reconcile against.
4. **Reconcile:** list the statement's lines against the month's ledger rows. Every payment out needs a receipt or invoice; every payment in needs a sales invoice or an explanation. Capture what the operator hands over with [capture](capture.md). What stays unmatched goes on the gap list with the amount and date.
5. **Check the month's obligations:** every task due in that month for the entity is closed, or has a thread line saying why not.
6. **Package for the accountant:** the list of files (statements, receipts, invoices, ledger extract) and a message to send in the operator's voice: what is enclosed, the gaps and why, questions the month raised. Match the channel and format the accountant asked for (see the entity profile or earlier threads); ask when it isn't known.
7. **Record the close** in `closes/<slug>/<YYYY-MM>.md`. Flat frontmatter, quoted month and dates:
   ```yaml
   ---
   month: "2026-10"
   status: closed      # closed | partial
   gaps: 2
   sent: null          # "YYYY-MM-DD" once the operator says it went out
   ---
   ```
   then what was enclosed, and every unmatched line in a fenced `yaml` block under `## Gaps`:
   ```yaml
   - { date: "2026-10-03", account: main, amount: 450.00, currency: MYR, direction: out, need: receipt, note: Transfer to a contractor }
   ```
   `need` is `receipt`, `invoice`, or `explanation`. A month with gaps is `partial` and still recorded, so the books show it as needing attention. When a gap is resolved (the receipt captured, the answer given), remove its entry; when none are left, set `status: closed`. When the operator says the package went out, set `sent`: the month then shows as with the accountant.
8. **Render** the dashboard with the engine's `render`.

**Reply:** the month's status per entity, the gap list, the files to attach, and the drafted message.
