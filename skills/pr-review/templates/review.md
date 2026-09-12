# Review report template

Fixed section order. Fixed legend. Summary blockquote first. `---` between sections. Omit a section only where noted; never reorder. Placeholders in `<angle brackets>`; drop the guidance lines in *italics* from the output.

Legend used everywhere: 🔴 blocker · 🟠 fix before merge · 🟡 nit or discussion · ❓ question for the author · ✅ verified clean

````markdown
# PR #<n>: <title as the PR states it>

> <Two or three sentences. The verdict, the one thing that matters most, and what the author needs to do. A reader who stops here knows whether this merges.>

---

## 📋 Overview

| | |
|---|---|
| **Author** | <login> · **Base** `<base>` <· layer <k> of a stack on #<parent> if stacked> |
| **Head** | `<short sha>` · <additions>+ / <deletions>− across <n> files |
| **Verdict** | <✅ Approve · ✅ Approve with fixes · 🟠 Changes requested · 🔴 Do not merge> — <one clause why> |
| **Risk** | <S/M/L/XL> · touches: <auth · data · schema · external service · public API · none> · tests <added/changed/none> |
| **Executed anywhere?** | <staging since <date> · never · prod via #<n>> |
| **Verified** | build <✅/❌/–> · lint <✅/❌/–> · format <✅/❌/–> · tests <✅ n/n · ❌ k failing · –> · <n> candidates dropped after verification |
| **Prior context** | <prior report links, task IDs, concept articles, or "none"> |

*Risk is a judgment: S = isolated, no auth/data/schema; XL = auth or value path plus schema plus no tests. Say what drove it.*

---

## 🧭 How it works

*The section the operator reads before talking to the author. Two screens at most. Start with the diagram when the change is a flow; start with the prose when it is a data-model or contract change.*

<Three to six sentences: what the PR changes, why, and the shape of the solution. Group by concern, not by file.>

```text
<ASCII diagram of the flow, state machine, or before/after. Boxes and arrows. Label the process (api / worker / frontend) and the boundary crossings.>
```

*Use a ```mermaid block instead only when a sequence or state diagram is genuinely clearer, then run the mermaid skill's Tier 1 check on the saved report.*

### Walkthrough

| Area | What changed | Why it matters |
|---|---|---|
| `<path or concern>` | <one line> | <risk or dependency in one line> |

### Questions to hold in your head

- <The two or three things the author must be able to answer. These are conversation openers, not findings.>

---

## 🔍 Findings

*Ranked: security/authz › data loss › domain invariant › correctness › regression › tests › conventions. Each finding is one anchor, one claim, one paste block. The paste block follows `references/comment-style.md`.*

### 🔴 Blockers

#### 1. <Claim in one sentence>

📍 `<path>:<line>` · <lane> · introduced by this PR

<Failure scenario in one sentence. Evidence in one or two: what you read, what you ran, file:line.>

```
<Paste-ready inline comment. Starts with "Blocking:". Uses a ```suggestion block when the fix is a drop-in.>
```

### 🟠 Fix before merge

#### <k>. <Claim>

📍 `<path>:<line>` · <lane>

<Failure and evidence.>

```
<Paste-ready comment.>
```

### 🟡 Nits and discussion

*Grouped by file, one paste block per file. Omit the section when empty.*

📍 `<path>` — <n> items

```
<One comment listing the nits for this file, one line each.>
```

---

## ❓ Questions for the author

*Findings that scored 40–74 in verification, phrased as questions with what would settle them. Omit when empty.*

1. 📍 `<path>:<line>` — <question, and what would settle it>

```
<Paste-ready question.>
```

---

## ✅ Verified clean

*What was checked and found right, so the author knows what the review covered. Three to eight lines. Not praise; facts.*

- <e.g. No handler on the request path modified: `orders.ts` and `billing.ts` diffs are import-line deletions only.>
- <e.g. The new guard matches the existing `RolesGuard` behaviour route by route.>

---

## 🧪 Checks run

| Check | Result | Notes |
|---|---|---|
| Build | <✅ pass · ❌ fail · – not run> | <n tasks · first error · why not run> |
| Lint | | |
| Format | | |
| Tests | | <n passed / k failed · environment artifacts separated · pre-existing failures named> |
| CI recorded | | <run id · what the workflow actually gates> |
| Verification pass | | <n candidates → n findings, n questions, n dropped> |

---

## 📝 Summary comment

*Optional top-level comment for the PR conversation. Under 120 words. Verdict, blockers as a numbered list with anchors, what was verified clean, what did not run.*

```
<Paste-ready summary comment.>
```

---

## 👀 Noticed, not this PR's problem

*Pre-existing defects seen along the way. One line each with an anchor. Omit when empty. These become tasks or follow-ups, never comments on this PR.*

- 📍 `<path>:<line>` — <one line>

---

## ⏭️ Not checked

- <Anything skipped and why: `--quick`, diff truncated, package not built, database not queried, a lane that did not return.>
````

## Notes for the writer

- The summary blockquote is the whole report for a reader in a hurry. Make it earn that.
- Anchors use the head commit's line numbers. Say so once in the Findings intro if the PR is likely to move under review.
- Do not pad. A clean PR gets a short report with a real "Verified clean" section, not manufactured nits.
- Never restate a bot's finding as yours. Re-verify it and cite it: "Bugbot flagged this; confirmed" or "Bugbot flagged this; does not apply because…".
