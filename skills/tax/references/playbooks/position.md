# Position

**You own that the operator always knows what tax they owe right now, and how sure that number is.** "How much tax do I owe?", "how much should I keep aside?", "can I spend this?", or a money decision that tax changes.

1. **Run the engine's `liability` command** (the command is in SKILL.md). For each entity it prints the tax if the year ended today, what is already paid (instalments, PCB withheld), owed now, the full-year projection, the monthly set-aside, how far the books reach (`coverage`), and what's `missing` or needs a `warning`.
2. **Lead with the total owed now** across entities, split business and personal, then the monthly set-aside: the share of every month's income that is really tax. That second number is what budgets and savings plans should subtract first.
3. **An unknown stays unknown.** An entity with `known: false` shows "—" and the reason, never RM 0. Say what would price it: a monthly close, the accountant's year-to-date figure as an `opening` row, or salary and invoices recorded for an individual.
4. **Say how sure the number is.** Name the coverage month, every warning (a foreign amount without its MYR value, a tax payment that names no YA, an unconfirmed residence), and that it is a planning figure: the tax agent's computation is the one filed.
5. **Close the gaps you can.** A missing month points at [close](close.md); a document the operator mentions goes through [capture](capture.md); an estimate on file well below the projection points at [estimate](estimate.md), with the penalty the engine priced.
6. **For an individual whose salary tax is withheld** (`personal` in the output), "owed now" is the wrong question: PCB already went out with every payslip. Lead instead with the filing balance (a top-up to pay or a refund due when the return is filed, at this pace), the tax the non-withheld income adds (the part to set aside from consulting and other business income), and the unused reliefs with what each would save. A relief marked `unconfirmed` (spouse, children) is a question for the operator, never a claim.
7. **Render the dashboard** with the engine's `render` so the page matches what you just said.

**Reply:** the owed-now total and its split, the monthly set-aside, each entity in one line (owed now, projection, books through; for a withheld individual, the filing balance and the best unused relief), and what would make the number firmer.
