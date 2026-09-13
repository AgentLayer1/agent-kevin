# Rehearsal

The interview that turns the walkthrough from a crutch into something the author knows. One `AskUserQuestion` per question, the room's voice, the room's misconceptions as the wrong options, and a correction against the code after every answer. Five questions take about three minutes.

## Picking the set

| Mode | Questions | When |
|---|---|---|
| `top` (default) | the Cue card's three "Coming at you", the provenance question, the newest open or 🟡 thread | the night before, or ten minutes before standup |
| `threads` | one per 🔴 or 🟡 thread, asked in the reviewer's own words | when the same reviewers are in the room |
| `all` | every Questions entry, in rank order | after a long gap since the PR was written |

Never more than twelve in one sitting. Past that the author is reading, not rehearsing.

## Phrasing the question

Say who asks, then ask it the way they would, using the names on the threads and the team: `<lead>: is dropping the API pool to 25 a concern?` · `<reviewer>: so the throttle is 800 per team now?` · `Bugbot said the env override is never read. Is it?` The name is not decoration: the author who has heard the question in that voice does not freeze when the voice is real.

## Building the options

Three or four. Exactly one is right. The right one is the doc's answer **reworded**: same claim, different sentence, so recognising the doc's phrasing does not pass the test. The distractors are the things someone in the room actually believes, in order of usefulness:

1. **The stale claim.** What the PR body, an old commit message, or an earlier reply said and the code no longer does. (For a pool-size PR: "api 50, worker 25, `DATABASE_POOL_MAX` overrides both.")
2. **The reviewer's original suggestion.** What the thread proposed before the author's answer. (`worker.kill()` so `exitedAfterDisconnect` gates the refork.)
3. **The pre-PR behavior.** How it worked on the default branch, stated as if it were still true. (The ORM disconnects in `onModuleDestroy`, before the server drains.)
4. **The answer that sounds right and is not.** A generic best practice that does not apply here. (A shared Redis counter for the throttle.)

Rules that keep it honest:

- Distractors are plausible and specific. No joke options, no absolutes, no strawmen. If a distractor is obviously wrong, it teaches nothing.
- All options are about the same length. The right answer is never the longest, never reliably first. Shuffle per question.
- Option descriptions are neutral: one line of what the option claims, no hint of verdict.
- A question whose answer is a number gets the real number and two neighbours that were once true or once proposed (25 · 30 · 50).
- A question whose honest answer is "I don't know yet" gets that as an option, worded as the Gap says it, and it is the right one. The author must be willing to pick it.

## Grading

Grade the claim, never the wording.

- **Picked the right option** → `✅ right`. Add `lead with <receipt>` when the doc's receipt is stronger than the option's phrasing.
- **Picked a distractor** → `❌`, then why that answer is what the room believes (one clause), the correct line, `file:line`. Two lines, no lecture. Picking the stale claim is the most useful miss there is: it is exactly what the room read.
- **Typed via Other** → compare each claim in the answer to the code. All claims hold → `✅`. Right claim, wrong or missing receipt → `🟡 right, lead with <receipt>`. A claim the code contradicts → `❌` with the contradiction and the line. Extra correct detail is not penalised; an invented reason is, even beside a right answer, because that is the habit that costs credibility in the room.
- **"I don't know"** typed or picked where the doc has an answer → `❌`, give the line, and it is re-asked. Where the doc says it is a gap → `✅`, and say the sentence to use out loud.

## Closing the set

1. Re-ask every missed question once, in plain chat, no options. Recall is the skill; recognition was the warm-up.
2. One line: `<n>/<N> first try · <k> re-asked · <j> still missed`.
3. Still missed → `Edit` the saved report: under **Answer from memory** in the Gaps section, one line per question: the question, the right line, the receipt.
4. If the author missed the provenance question, say so plainly and point at the Evidence table: that is the one answer that cannot be looked up on the day.

## Boundaries

- Never invent a question the doc cannot answer with a receipt; if the interview surfaces one, it becomes a Gap, not a quiz item.
- Never grade harshly on register. "It's fine, it's measured" is a pass if the measurement exists.
- Stop when the author says stop. A half-finished set still gets the scoreboard and the report append.
