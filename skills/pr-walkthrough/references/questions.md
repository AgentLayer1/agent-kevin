# Reviewer questions

What the room actually asks when an author walks a PR. Use this catalogue to generate the Cue card's "Coming at you" and the Questions section: pick the ones the diff makes live, rank by likelihood (a question already asked on the PR first, then Provenance, then whatever the 🔴 hunks invite), and answer each in the author's voice with a receipt.

## The answer shape

`<claim in one line> · <receipt>`

- The claim is what the author says out loud. First person, present tense, plain words.
- The receipt is what they point at if pressed: `file:line`, a task id, a PR number, a spec name, a measurement with its number, a session date, a reviewer's thread.
- One line. If the honest answer needs a paragraph, the hunk needs simplifying, not the answer.

## The honest-gap rule

When no receipt exists, the answer is a gap and it says so: `I don't know yet; I'll <check the spec / measure it / ask <name>> by <standup tomorrow / before merge>.` It also lands in the report's Gaps section with an action. Never write an answer that sounds right. A reviewer who catches one invented reason stops trusting every other line, and the cost lands on the whole team's case for generated code.

## Catalogue

### Intent

- Why now? What broke, or who asked?
- Why this shape and not the obvious one? What did you reject, and what decided it?
- What is the smallest change that would have fixed it? Why is this bigger?
- Is this the whole fix, or a step? What comes after?

### Correctness

- What happens when `<input>` is null, empty, or duplicated?
- What happens when the external service / DB call fails halfway?
- What happens when two of these run at once?
- Which state does the record sit in if this throws? Who moves it on, and is that designed or accidental? (A documented invariant in `knowledge/concepts/` decides the designed answer.)
- Which process runs this, the request path or a background job, and what happens if it is the other one?

### Blast radius

- Who else calls this? Did you grep? How many?
- Which readers of this field did you check after changing the write? (A deleted write is only safe once every read of that column is accounted for.)
- Does this change a response shape any integrator depends on?
- Does this touch a path that checks authorization, moves money, or gates a documented invariant? Show me the lines before and after.

### Conventions

- Why a new helper instead of the one in the shared package the repo already has?
- Why does this file's style differ from its neighbors?
- Why is this constant here and not beside the one that already exists?
- Why is this comment here? (The answer is a *why* the code cannot say, or the comment goes.)
- Why is this file in the PR at all?

### Testing

- What did you run, and where? Local, a staging branch, a seed script?
- Which of these branches has a test that would fail if the fix were reverted?
- What is not covered, and why is that acceptable for this merge?
- Does the video show the failure paths or only the happy one?

### Operations

- How do we roll this back? Is the migration reversible?
- What order do the migration and the code deploy in? (The repo's deploy docs or a concept article decide.)
- Is it behind a flag or a per-team gate? What turns it on?
- What does the log line say when this fires, and would we notice if it fired a thousand times?

### Provenance

The group that decides whether generated code is trusted. Answer it with evidence, never with defensiveness or an apology.

- Which parts of this did the model write?
- How do you know those parts are right? (Per hunk class: the test that pins it, the measurement, the reviewer thread, the line you read and can explain.)
- What did the model get wrong that you caught? (Having an answer here is a strength; it shows the review happened.)
- Which hunk here can you not yet explain? (The honest answer is the Gaps table, read aloud.)

## Pre-empting

The three questions most likely to be asked *first* (not the hardest) go in the Cue card under "Coming at you", and the facts that answer them go under "Lead with". Saying the answer inside the walk, before the question, costs one sentence and removes the sting: the reviewer hears their concern named and handled. Pick them from: the newest open thread, the provenance question, and whatever the biggest ★ hunk invites.

## If lost

Under pressure the failure mode is filling silence with a guess. Give the author lines that hold the floor honestly:

- "Let me pull that line up." (then use the Tour number)
- "That's <reviewer>'s thread; the fix is on the branch, reply going up today." (Threads state 🟡)
- "I don't know yet. I'll check `<x>` and post the answer on the PR today." (a Gap, said out loud)
- "Right, that's a gap. The plan is `<action>` before merge." (a 🔴 with no receipt)
- "The measurement says `<n>`; I can share the run." (when asked to justify a constant)

## Don't say

Phrases that cost credibility for the whole approach, not just the hunk:

- "The AI wrote that part." Provenance is answered with how it was verified, never with who typed it.
- "I think" or "it should" about anything in Evidence. Either it ran, or it is not claimed.
- "It works" without the observable. Say what the viewer would see.
- "That was already like that" for a hunk this PR touched. If the PR touched it, the author owns it.
- "Fixed" for anything not on the branch head. "Fix is written, goes up in the next push" is the honest form.
- A reason invented on the spot. One caught invention makes every other line suspect.

## Ranking

1. Questions already asked on the PR (`github_pr_comments`), marked `asked`.
2. The Provenance question, always, phrased as the room phrases it.
3. Questions the 🔴 hunks invite, one per hunk.
4. Questions the touched surface invites: authorization, money, or invariant paths get the Correctness and Blast radius groups; schema changes get Operations; a new helper gets Conventions.
5. Everything else, only if it fits above the fold.
