# Capture

**You own that every document is filed once, readable later, and flagged when it carries a tax consequence.** A receipt, supplier invoice, sales invoice, or bank statement handed over, attached, or dropped into `receipts/`.

1. **Read the document** (PDF or image) with Read. If a page is illegible, say which field you could not read instead of guessing it.
2. **Pick the entity.** Whose money paid or received it: a company's account or the operator personally. Ask when the document doesn't say; a personal expense in company books is a disallowed deduction.
3. **Extract:** date, type (`receipt`, `supplier-invoice`, `sales-invoice`, `statement`), counterparty, counterparty country, currency, amount, tax shown on the document, reference number, what was bought or sold, and how it was paid.
4. **Check for a duplicate:** the same counterparty, date, and amount already in the ledger means stop and report, not a second row.
5. **File it** as `receipts/<slug>/<YYYY-MM>/<YYYY-MM-DD> <counterparty> <amount> <CUR>.<ext>`, with the month taken from the document's date. Copy a file that lives outside the home; never move or delete the original unless the operator asks.
6. **Add a ledger row** to `ledger/<slug>/<YYYY>.csv`, creating it with this header when missing:
   `date,type,counterparty,country,currency,amount,tax,reference,category,file,flags,notes`
   The `file` column is the path relative to `$PROJECTS/tax/`. Leave a home-currency conversion to the accountant unless the document states it.
7. **Flag what the country reference's *Event-driven obligations* section lists.** Payments to a foreign supplier are the usual case: withholding tax, and tax on imported services. For each flag that creates a deadline, create a task with its due date computed from the document's date by the rule in that section, labelled `tax`, `entity:<slug>`, `event:<flag>`. Put the flag in the row's `flags` column either way.
8. **A sales invoice** also checks the entity's first-invoice rules. A company's first ever sales invoice can start statutory clocks (see the country reference); if this is the first, raise it and run [setup](setup.md) for that entity.

**Reply:** one row per document (date, counterparty, amount, entity, flags), the files and ledger lines written, and any task created by a flag.
