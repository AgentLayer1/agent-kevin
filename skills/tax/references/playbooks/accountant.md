# Accountant

**You own that nothing the accountant asks for gets lost in an inbox.** An email, letter, screenshot, or notice from the accountant, tax agent, company secretary, or tax authority.

1. **Read it all,** attachments included. A notice from the authority (an assessment, a penalty, a compound) is urgent by default: find its payment or reply deadline first.
2. **Extract every item:** each request for documents, each decision they need, each deadline, fee, or amount payable, and each fact they state about the entity (a filing done, a date, a status).
3. **Turn each actionable item into a task** in the `tax` project: `entity:<slug>` and `accountant` labels (the books list open ones as what is open with the accountant), a due date from the message (or a sensible one, said so), and the sender and date in the description. Thread onto an existing task instead when the item continues one.
   Questions about individual bank lines ("what is this payment for?") are not tasks: each becomes an entry in that month's `## Gaps` block (see [close](close.md) step 7), `need: explanation` or the document they want, so a month with thirty queries is one month needing attention, not thirty tasks.
4. **Update the entity profile** with durable facts the message states (filings made, estimate on file, commencement date, status), with the message as the source. When they confirm the books are current through a month (management accounts, a bookkeeping update), set `booked_through` to it. A stated obligation not yet in the profile goes through [setup](setup.md) step 5.
5. **Draft the reply** in the operator's voice: the answer in the first words, one line per item they asked about, what's attached, and any question back. No labels, no scaffolding.
6. **Payments:** an amount due gets a task due on its deadline, with the payment reference from the notice. When the operator pays, the receipt goes through [capture](capture.md) and the task closes on it.

**Reply:** the items found (who acts, by when), the tasks created or threaded, the profile facts updated, and the drafted reply.
