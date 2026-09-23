# Technical writing

For docs, READMEs, RFCs, plans, PR descriptions, and commit messages: writing a tired engineer understands on the first read. The humanizer skill owns the catalog of AI tells; SOUL's punctuation rules win over anything here (colons and parentheses are fine; em-dashes are not).

**Three rules above everything:**

- **Cut every word that does no work.**
- **Use the short, everyday word.**
- **When a rule makes a sentence worse, fix it another way or leave it.**

**The codebase is the word list.** Write the real symbol, file, flag, or command, not a synonym. Don't invent jargon ("ratchet", "evacuate", "endgame"); name the mechanism.

## Pick the mode first (Diátaxis)

One document, one mode. Don't mix them; split and link instead.

| | Serves learning | Serves work |
|---|---|---|
| **Action** | **Tutorial.** The reader builds something, and every step shows a visible result. Commands, "we". | **How-to.** Solves a problem the reader has. Assumes competence, allows forks ("if you want X, do Y"). Titled by the task. |
| **Understanding** | **Explanation.** One bounded topic: context, decisions, history, alternatives. The only mode with opinions. | **Reference.** Facts for lookup: dry, complete, mirrors the structure of the thing described. Generated from code where possible. |

## Write sentences to the reader

- **"You", present tense, commands for instructions.** "Click Submit", never "should be done".
- **Say who does what** ("the compiler checks", not "is checked").
- **The condition goes before the instruction:** "To delete the file, run…". The common case goes first, exceptions after.
- **Never "simply", "easy", or "quickly"** in a procedure. If it were easy, the reader wouldn't be here.
- **Headings carry the point,** not just the topic. Sentence case. Task headings are verb phrases.
- **Lists:** numbered for sequences, bullets for everything else, introduced by a full sentence, items parallel.
- **Links say where they go.** Never "click here".

## Load one statement at a time

- **One instruction per sentence.** Split instructions over about 20 words and other sentences over about 25.
- **The warning goes before the step it guards.**
- **Keep "the" and "a"**, and give each word one meaning. Pick one word per action and stick to it.

## Leave no sentence open to two readings

- **"Only" and "not" sit next to the word they change.**
- **Break up long noun strings.**
- **Every "it", "this", and "they" points at one obvious thing.** Repeat the noun when in doubt.
- **Don't drop verbs.**
- **No slashes for "and/or"**; write "a, b, or both".
- **Call each thing by one name everywhere,** and don't reword unchanged sentences between edits.

## Rhythm and specifics

- **Mix sentence lengths.** Short lands a point; a longer one carries a fact with its condition.
- **Be specific, not sterile:** not "schema changes can cause issues" but "a column rename fails the build".
- **Every count or tree claim is true at the commit that lands it,** with the command that regenerates it.

**Before:** "Configuration of the budget script parameters is performed via budget.json. Note that it's important to remember that running with --write should only be done when lowering it."

**After:** "`budget.ts` reads the committed budget from `budget.json`. If the count exceeds the budget, CI fails. Run `budget.ts --write` only to lower the budget."

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `technical-writing` skill (sources: diataxis.fr, Google developer documentation style guide, ASD-STE100, Kohl's Global English Style Guide) (MIT, Copyright (c) 2026 Lauren Tan).
