# Walkthrough report template

The reader is on a shared screen, being questioned, glancing at this in a half-width pane. Every line is a cue they can take in without reading: twelve words at most, no tables wider than three columns, no paragraphs anywhere. Three lookups, matched to where the room is pointing: the **Tour** when someone points at a file, **Threads** when a reviewer starts from their own comment, **Questions** when it is a "why". The **Cue card** at the top is the whole doc for the two minutes of talking.

Fixed section order. `---` between sections. Placeholders in `<angle brackets>`; drop the guidance lines in *italics* from the output. Under `--standup` omit Record; under `--record` omit Cue card, Threads, Tour, Questions.

Legend: ★ a place the room will look (five at most) · 💬 came from a review thread · 🤖 bot · ✅ fixed and replied · 🟡 fixed, reply not posted · 🔴 open · ✔ resolved · 🎬 scene

````markdown
# PR #<n>: <title as the PR states it>

> <One line. The fifteen-second answer to "what is this": problem, change, result. Stacked: "layer <k> on #<parent>".>

`<sha>` · `<base>` · <adds>+ / <dels>− · <n> files · ★ <n> · 💬 <n> threads (<k> open) · 🎬 <n> scenes ≈ <m> min

---

## 🃏 Cue card

*One screen. Say it, don't read it.*

**Walk (2 min)**
1. Problem · <cue>
2. Change · <cue>
3. Why this way · <cue, names what was rejected>
4. Tested · <cue, only what Evidence proves>
5. Ask · <the one decision, or "FYI"> 

**Lead with** *(pre-empt: say these before anyone asks)*
- <the fact that answers the top thread>
- <the fact that answers the provenance question>
- <the measurement or spec that carries the claim>

**Coming at you**
- <Q in ≤ 6 words> → <A in ≤ 8 words> · <receipt>
- <Q> → <A> · <receipt>
- <Q> → <A> · <receipt>

**If lost** · "<one honest line to hold the floor: 'let me pull that line up' / 'I don't know yet; I'll check <x> and post on the PR today'>"

---

## 💬 Threads (conversation order)

*Every thread, resolved or not, bots included. The reviewer is in the room and starts from their own comment.*

1. **<reviewer> · `<file:line>` · <✅ · 🟡 · 🔴 · ✔>**
   - said · <their point, ≤ 12 words>
   - say · "<your answer, ≤ 15 words>" · <receipt>
2. **<reviewer> · `<file>` (outdated) · <state>**
   - said · <…>
   - say · "<…>" · <receipt>

---

## 🗺️ Tour (Files-tab order, every hunk)

*One line per hunk: where · cue → if pressed. ★ on the files the room will look at.*

**1 · `<path>`** ★
- `:<lines>` <cue, ≤ 8 words> → <if pressed, ≤ 15 words> · <receipt>
- `:<lines>` <cue> → <if pressed> · <receipt>

**2 · `<path>`**
- `:<lines>` <cue> → <if pressed>

**Reach** · <callers of changed symbols · readers of changed fields · counts>

---

## ❓ Questions

*Ranked. Threads first (💬), then provenance (🤖), then what the ★ hunks invite.*

1. 💬 <Q> → <A, ≤ 15 words> · <receipt>
2. 🤖 Which parts did the model write, how do you know they're right? → <A: the specs, the measurement, the reviewer's own test> · <receipt>
3. <Q> → <A> · <receipt>
4. <Q, no receipt> → "I don't know yet; I'll <action> by <when>" · Gaps #<k>

---

## 🎬 Record (<n> scenes ≈ <m> min)

**Prep** ☐ <env + seed> ☐ <spec to run outside the sandbox, if any> ☐ windows: <layout> ☐ Focus on, no `.env` on screen ☐ PR title first 3s, say scene numbers

**1 · <path name> · <⏱>**
- do · `<command / flow / request>`
- see · <the observable: status, body field, row, log line>
- say · "<phrase>"

**2 · <path name> · <⏱>**
- do · <…>
- see · <…>
- say · "<…>"

**Not demoed** · <branch> → <stand-in: spec, log line, run column>
**After** · `/pr-walkthrough <n> --check <video>` · attach to the PR · body line: `Video: <link>, scenes 1–<n>: <labels>`

---

## 🧪 Evidence

| Check | Result | Note |
|---|---|---|
| Build | <✅ · ❌ · –> | <first error · why not run> |
| Lint | | <PR files vs pre-existing> |
| Format | | |
| Tests | | <n pass · k fail · environment artifacts named> |
| CI | | <run id · what it gated, or "continue-on-error, not a gate"> |
| Seed / fixtures | | <command · env · result · or "not run"> |

---

## 🔴 Gaps

*What the room finds if you don't name it first. Omit only when none, then write `No gaps.`*

1. **<what>** · <why, ≤ 15 words> → **<Simplify · Revert · Ask · Describe>** <detail>

**Not demoed** · <branches, or none>
**Answer from memory** · *(the rehearsal appends a line per question still missed after the re-ask: question · right line · receipt)*
````

## Notes for the writer

- Cut words until each line is a cue. "pid on every log line" beats "every api log line carries the worker pid so a worker can be told apart". The receipt carries the depth; the cue carries the glance.
- Every hunk gets its own line, including the trivial ones. Completeness is what lets the author say "I read all of it"; the ★ is what keeps that from burying the important five.
- Write "say" cells as the author speaks: first person, present tense, no file paths out loud (the tour number carries the path).
- A thread whose fix is on the branch but whose reply is not posted is 🟡, and it is also a Gap: the reviewer will re-raise it.
- "Coming at you" is the three questions most likely to be asked *first*, not the three hardest. Pre-empt them in the walk when it costs one sentence.
- Every "see" cell must be checkable by a viewer who does not know the code. "Correct response" is not an observable; `exit=1` and `4 pids` are.
- No padding. A clean PR gets a short doc with `No gaps.`
