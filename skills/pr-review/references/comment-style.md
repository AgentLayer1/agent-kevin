# Comment and reply style

Everything in a paste block is read by a colleague, on GitHub, out of context, often on a phone. It has to land in one read. Read this before writing the first block.

## Shape of a review comment

```
<Consequence in one sentence, as a fact about what happens.>

<Why: the evidence, one or two sentences, with file:line or what you ran.>

<The fix. A ```suggestion block when it is a drop-in replacement for the anchored lines; otherwise a short diff or one sentence.>
```

One claim per comment. If two things are wrong on one line, two comments.

Open with the outcome, not the code: "A crash between the provider 201 and the local update orphans the record and the retry duplicates it" beats "This should use an idempotency key". The reader gets the stakes first and can stop there.

State whether it blocks. Start with `Blocking:` when it must change before merge. Anything else is non-blocking by default; say `Non-blocking:` only when the reader might otherwise wonder.

## Length

- 30 to 90 words for a finding. Longer means the finding is two findings or the evidence belongs in the report, not the comment.
- Questions are one or two sentences plus what would settle them.
- Nits are one line, and grouped: one comment per file listing them, or one line in the summary comment. Never a comment per nit.

## Suggestions GitHub can commit

A ```suggestion block replaces exactly the lines the comment is anchored to. The operator pastes it as an inline comment on those lines and the author gets a **Commit suggestion** button. This is the closest thing to a one-click fix without write access, so use it whenever the fix is a drop-in of ten lines or fewer:

````
Blocking: `in` walks the prototype chain, so `'toString'` passes and `held.includes` throws a 500.

```suggestion
const isUserRole = (value: string): value is UserRole => Object.hasOwn(ROLE_PERMISSIONS, value);
```
````

Indentation inside the block must match the file. For a fix that spans functions or files, describe it or give a unified diff in a ```diff block; do not use ```suggestion for anything that is not a literal replacement of the anchored range.

## Words

- Plain language. Say "the order stays stuck" not "the state machine fails to converge".
- No filler openers ("Great work", "Just a thought", "I might be wrong but"). No closers ("Thoughts?", "Let me know").
- No emojis inside a paste block. The report uses them for the legend; GitHub comments do not.
- No hedges when you verified it. "This throws" not "this might throw". When you did not verify, it is a question, and it is phrased as one.
- Name prior art by number: "same class as #412", "#500 removed this write". Never link to anything in the operator's HOME.
- Never paste customer PII from a database. Counts and IDs only.

## Questions for the author

A question is a finding you could not verify. It carries what would settle it:

```
Does anything call `reuseExistingCustomer` on this branch? I count 0 call sites here and 3 on main. If it was dropped on purpose, what handles the 409 duplicate-identity path now?
```

Never dress a finding as a question to soften it, and never dress a guess as a finding to sound sure.

## The summary comment

If the operator wants one top-level comment as well as inline ones, it is: the verdict in one line, the blockers as a numbered list with anchors, one line on what was verified clean (so the author knows what was actually checked), and what was not run. Under 120 words. No poem.

## Replies on your own PR

The reader is the reviewer who took time to write the comment. Respect that with speed and specifics.

- **Accurate:** agree in the first four words, then say what changed and where. "You're right. Fixed in `roles.service.ts:107`, and the spec now pins it." Not "will fix": fix first, then reply.
- **Partially accurate:** the true half first, then the correction with a receipt. "Right that the claim is never released. It is not a leak though: the reaper at `loop.service.ts:903` runs every tick. Added a test so that stays true."
- **Inaccurate:** receipts, not opinions, and no defensiveness. "Checked this against prod: `state` is populated on 78,738 of 82,029 rows, `stateRegionOrProvince` on 3. Leaving it as `state`." If it was a bot, still answer as if a person will read it, because one will.
- **Question:** answer it plainly, then if the answer should live in code, say where you put it (a one-line why comment, a test name, the commit body). Do not restate the question.
- **Preference:** decide, say the trade-off in one sentence, move on. "Kept it inline: it has one caller and the name would outlive the call."
- **Your own earlier answer was wrong:** say so first. "Correcting my earlier answer: wallets take the IBAN like any other bank, so the zero-strip is gone."
- A reviewer's suggestion that would break an invariant documented in `knowledge/concepts/` gets a clear no with the reason, in two sentences, and a one-line comment in the code so the next bot does not re-flag it.
- Never say "fixed" for anything not yet in the working tree. Never say "pushed" for anything not pushed; the operator commits and pushes, so the reply says "fixed, in the next push" until then.
