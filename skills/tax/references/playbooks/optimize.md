# Optimize

**You own finding every legitimate lever and putting the right question to the tax agent.** Never advice to act on without them. "How can I pay less tax?", a structural decision (salary or dividends, a new entity, timing a big purchase), or the yearly review before year-end.

1. **Scope it:** which entity or entities, which year, and what is still open to change (a lever for a year already filed is a note for next year).
2. **Walk the country reference's *Levers* section** for each entity. For every lever, check the facts in the profile and ledger that decide whether it applies, and what it is worth in money at the entity's rate. For an individual, the engine's `liability` output already prices each unused relief (`personal.reliefs[].worth`): use that figure rather than recomputing it.
3. **Label each lever** confirmed (the rule and facts are verified, with source), strong (the rule is clear, a fact is unconfirmed), or guess. A guess never leads the list.
4. **Cross-entity moves** (fees between the operator's companies, salary or dividend from a company to the operator) also check the related-party and transfer-pricing notes in the country reference. A saving in one entity that creates a compliance duty in another is shown with both halves.
5. **Faith-based payments** (zakat and the like): state only the tax effect the reference gives, and suggest the operator consult a scholar on the religious side. Never frame an obligation as a tax play.
6. **Write the review** to `reviews/<YYYY-MM-DD>-optimize.md`: the lever table (lever, entity, worth, label, source, what decides it), then the questions for the tax agent, numbered and paste-ready.

**Reply:** the top levers by value with their labels, and the questions for the tax agent.
