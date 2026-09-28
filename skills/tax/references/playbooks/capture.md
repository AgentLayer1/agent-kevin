# Capture

**You own that every document is filed once, readable later, and flagged when it carries a tax consequence.** A receipt, invoice, payslip, statement, or tax payment handed over, dropped into `inbox/` (dropping a file there is the operator's permission to read it), or a figure the operator states instead of a document ("September salary 28,000, PCB 4,200").

1. **Read the document** (PDF or image) with Read. If a page is illegible, say which field you could not read instead of guessing it.
2. **Pick the entity.** Whose money paid or received it: a company's account or the operator personally. Ask when the document doesn't say; a personal expense in company books is a disallowed deduction.
3. **Extract** (never a residential address; a document showing one is filed as is, the address left out of every field): date, type, counterparty, counterparty country, currency, amount, the MYR value when the currency is foreign, tax shown on the document, reference number, what was bought or sold, and how it was paid. The type decides how the engine counts the row:

   | type | Counts as |
   |---|---|
   | `sales-invoice` | business income |
   | `receipt`, `supplier-invoice` | a deductible expense, unless flagged `non-deductible`, `capital`, or `personal` |
   | `salary` | employment income; the `tax` column holds the PCB withheld, which counts as paid |
   | `tax-payment` | paid toward the YA named in `reference` (`YA 2026 instalment 3`); a payment without a YA is not counted |
   | `zakat` | an individual's rebate or a company's capped deduction |
   | `relief` | spending that counts toward a personal relief; `category` holds the relief's id from the country file's `reliefs:` list (`lifestyle`, `medical`, `prs`), and the engine caps the total at the relief's limit |
   | `opening` | the accountant's profit to date, as of the row's date (from management accounts) |
   | `statement` | kept for the close, not counted |

   A figure the operator states becomes a row the same way, with `file` left empty and `notes` saying who stated it and when. A foreign amount without a stated or documented MYR value stays blank in `amount_myr`: the engine leaves it out and says so, never converts at a guessed rate.
4. **Check for a duplicate:** the same counterparty, date, and amount already in the ledger means stop and report, not a second row.
5. **File it** as `receipts/<slug>/<YYYY-MM>/<YYYY-MM-DD> <counterparty> <amount> <CUR>.<ext>`, with the month taken from the document's date. Move a file out of `inbox/` once filed; copy a file that lives anywhere else, and never move or delete that original unless the operator asks.
6. **Add a ledger row** to `ledger/<slug>/<YYYY>.csv`, creating it with this header when missing:
   `date,type,counterparty,country,currency,amount,amount_myr,tax,reference,category,file,flags,notes`
   Several flags are separated by `;`.
   The `file` column is the path relative to `$PROJECTS/tax/`. Leave a home-currency conversion to the accountant unless the document states it.
7. **Flag what the country reference's *Event-driven obligations* section lists.** Payments to a foreign supplier are the usual case: withholding tax, and tax on imported services. For each flag that creates a deadline, create a task with its due date computed from the document's date by the rule in that section, labelled `tax`, `entity:<slug>`, `event:<flag>`. Put the flag in the row's `flags` column either way.
8. **A sales invoice** also checks the entity's first-invoice rules. A company's first ever sales invoice can start statutory clocks (see the country reference); if this is the first, raise it and run [setup](setup.md) for that entity.

**Reply:** one row per document (date, counterparty, amount, entity, flags), the files and ledger lines written, and any task created by a flag.
