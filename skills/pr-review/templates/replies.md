# Replies report template

For the operator's own PR. The report scrolls beside GitHub's **Conversation** tab: threads appear in the same top-to-bottom order GitHub shows them (file order, then line). Every thread that needs a reply gets one; threads that only need a Resolve click go in the final table. Fixed order, `---` between sections.

Legend: ✅ accurate, fixed · ◐ partially accurate · ✗ inaccurate, pushing back · 💬 question, answered · ⚖️ preference, decided · 🤖 bot author

````markdown
# PR #<n> replies: <k> threads need a reply, <m> need only Resolve

> <Two or three sentences: how many threads, how many fixes landed in the working tree, the one thread that matters most, and whether anything is being pushed back on. If this supersedes an earlier replies report, say so here.>

---

## 📋 State

| | |
|---|---|
| **Threads** | <total> · <k> need a reply · <m> resolved or answered · <b> from bots |
| **Reviewers** | <login (n comments)>, <login (n)> · <bot (n)> |
| **Head judged** | `<sha>` · <n> threads marked outdated (anchors moved; re-found by content) |
| **Fixes in working tree** | <n> files changed, uncommitted · build <✅/❌> · specs <✅ n/n / ❌> |
| **Pushing back on** | <n> threads · <one clause each, or "none"> |
| **Supersedes** | <relPath of the prior replies report, or "none"> |

---

## Threads, in PR scroll order

### 1 · <Short topic> <legend mark>

📍 `<path>:<line>` <(outdated)> · [thread](<url>) · <reviewer> <🤖 if bot>

> **<Reviewer>:** <their comment, quoted, trimmed to what you are answering>

**Verdict:** <one line: accurate / partially / inaccurate / question / preference, and why in a clause.>
**Changed:** <`path:line` what you changed, spec added, or "nothing, see reply">

```
<Paste-ready reply. Follows references/comment-style.md → "Replies on your own PR".>
```

---

### 2 · …

---

## 🔎 Found on my own

*From the self-pass over the diff. Same fix discipline: fixed in the working tree, spec added where it pins behaviour. Omit when empty. Each gets an optional unprompted comment for the PR, so reviewers see you found it.*

#### <Claim>

📍 `<path>:<line>` · <lane>

<Failure and evidence in two sentences. What changed.>

```
<Optional comment to leave on the line: what was wrong, what changed. Two sentences.>
```

---

## 🧾 Suggested commits

*One per group of related fixes. The operator commits; these are drafts. Subject line, blank line, body that states the reason, not the diff.*

```
<subject ≤ 72 chars>

<Why, two to five lines. Name the reviewer or thread that asked for it.>
```

---

## ✅ Just needs Resolve

| # | Anchor | Topic | Why it is done |
|---|---|---|---|
| 1 | `<path>:<line>` | <topic> | <answered on <date> · fixed in `<sha>` · reviewer confirmed> |

---

## 🧪 Checks run

| Check | Result | Notes |
|---|---|---|
| Build after fixes | | |
| Specs touched | | <names> |
| Lint / format on changed files | | |
| Database queries | | <what was checked, counts only> |

---

## ⏭️ Not checked / follow-ups

- <Threads whose claim needs a measurement you could not run, a fix that belongs in another PR (with why), pagination that was partial.>
````

## Notes for the writer

- Scroll order is the whole point of the layout. Sort by the file order GitHub uses (as `github_pr_view` lists `files`), then by line. Conversation-tab comments that are not inline go last, before the Resolve table.
- The reply block never says "will fix". The fix is in the working tree before the reply is written, or the reply says what blocks it.
- Quote the reviewer faithfully; trim, never paraphrase, inside the `>` block.
- One report per PR per run. A re-run supersedes; name the superseded path in State and delete nothing (the index keeps history).
