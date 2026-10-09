# Review report template

Fixed section order. Fixed legend. Summary blockquote first. `---` between sections. Omit a section only where noted; never reorder. Placeholders in `<angle brackets>`; drop the guidance lines in *italics* from the output.

Legend used everywhere: 🔴 blocker · 🟠 fix before merge · 🟡 nit or discussion · ❓ question for the author · 💬 needs a human decision · ✅ verified clean

````markdown
# PR #<n>: <title as the PR states it>

> <Two or three sentences. The verdict, the one thing that matters most, and what the author needs to do. A reader who stops here knows whether this merges.>

---

## 📋 Overview

| | |
|---|---|
| **Author** | <login> · **Base** `<base>` <· layer <k> of a stack on #<parent> if stacked> |
| **Head** | `<short sha>` · <additions>+ / <deletions>− across <n> files |
| **Verdict** | <✅ Approve · ✅ Approve with fixes · 💬 Needs discussion · 🟠 Changes requested · 🔴 Do not merge> — <one clause why> |
| **Risk** | <S/M/L/XL> · touches: <auth · data · schema · external service · public API · none> · tests <added/changed/none> · files <n risk · n logic · n mechanical> |
| **Explainer** | <path to the .html beside this report · omit the row when none was written> |
| **Executed anywhere?** | <staging since <date> · never · prod via #<n>> |
| **Verified** | build <✅/❌/–> · lint <✅/❌/–> · format <✅/❌/–> · tests <✅ n/n · ❌ k failing · –> · <n> candidates dropped after verification |
| **Prior context** | <prior report links, task IDs, concept articles, or "none"> |

*Risk is a judgment: S = isolated, no auth/data/schema; XL = auth or value path plus schema plus no tests. Say what drove it. The file counts come from the foundation's triage.*

---

## 🎯 Where to look

*Where the operator's own attention goes. The lanes read everything; this is what a human should still read. One screen.*

**Read yourself**

1. 📍 `<path>:<lines>` — <why this needs human judgment: the decision, the invariant, the risky surface>

*Five at most, from the `risk` files first. A clean PR still names the hunk that carries its behavior.*

**Skim** · <n> mechanical files: <what they are, as counts: "14 renames from the `Order` → `Purchase` move, 3 generated clients, 2 fixtures">

**Decisions this PR makes for you**

| Decision | Picks | 📍 |
|---|---|---|
| <a product or behavior choice made in code: a default, threshold, limit, timeout, retry count, error message, retention, who may do what> | <the value it picks> | `<path>:<line>` |

*Only choices someone could reasonably have made differently. Omit the table when there are none.*

**Asked vs delivered** *(omit when the linked issue or task states no criteria)*

| Criterion | Status | 📍 |
|---|---|---|
| <criterion as written> | <✅ met · ❌ not met · ❓ untested> | `<path>:<line>` |

---

## 🧭 How it works

*The section the operator reads before talking to the author. Two screens at most. Start with the diagram when the change is a flow; start with the prose when it is a data-model or contract change.*

<Three to six sentences: what the PR changes, why, and the shape of the solution. Group by concern, not by file.>

```mermaid
%% Diagram of the flow, state machine, or before/after. Pick the type that fits:
%% sequenceDiagram for a call across processes, stateDiagram-v2 for a lifecycle,
%% flowchart for a data path. Label the process (api / worker / frontend) and the
%% boundary crossings.
```

*Always Mermaid: the report is read in Obsidian and on GitHub, which render it. Run the mermaid skill's Tier 1 check on the saved report so a block that fails to parse never reaches review. ASCII belongs in the chat hand-back, not in the file.*

### Walkthrough

| Area | What changed | Why it matters |
|---|---|---|
| `<path or concern>` | <one line> | <risk or dependency in one line> |

### Before → after

| Case | Before | After |
|---|---|---|
| <an input, actor, or situation, as a caller or user meets it> | <what happened> | <what happens now> |

*One row per case whose behavior changed. A pure refactor says "No behavior change" in one line, and the lanes hold it to that.*

### Questions to hold in your head

- <The two or three things the author must be able to answer. These are conversation openers, not findings.>

---

## ⚖️ Case against

- **Strongest argument against merging:** <one or two sentences>
- **Most likely to bite in three months:** <one or two sentences>
- **If 40% had to go:** <what goes and why; what stays is what to read hardest. On an oversized PR, this is the stack split to suggest.>

---

## 🔍 Findings

*Ranked: security/authz › data loss › domain invariant › correctness › regression › performance › tests › conventions. Each finding is one anchor, one claim, one paste block. The paste block follows `references/pr/comment-style.md`. Omit a severity heading with nothing under it; with no findings at all, the section is one line saying so.*

### 🔴 Blockers

#### 1. <Claim in one sentence>

📍 `<path>:<line>` · <lane> · introduced by this PR · <principle or repo rule, when one applies>

<Failure scenario in one sentence. Evidence in one or two: what you read, what you ran, file:line.>

```
<Paste-ready inline comment. Opens with the issue, no severity prefix. Uses a ```suggestion block when the fix is a drop-in.>
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

## 🤖 Bot comments

*Every review-bot comment that made a claim, verified like a lane finding. Omit when there were none.*

| Bot | 📍 | Claim | Disposition |
|---|---|---|---|
| <login> | `<path>:<line>` | <the bot's claim in a few words> | <✅ confirmed → #k · ❓ question #k · ❌ false positive: <why> · ✔ already fixed · – out of scope> |

*A false positive gets a reason the operator can paste as a reply to the bot's thread.*

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
| Verification pass | | <n candidates (k from bots, j from the case against) → n findings, n questions, n dropped> |
| Coverage | <✅ n/n · ⚠️ k of n> | <n files on the checklist · n reviewed · n skipped, with reasons · n excluded as generated> |

*Add a row after Tests for any gate the repo's own docs require (typecheck, a server boot, a smoke script); keep the rows above in this order.*

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

## 🗑️ Dropped after verification

*Candidates that scored below 40. One line each so the operator can rescue one. Omit when empty.*

<details>
<summary><n> candidates dropped</summary>

- 📍 `<path>:<line>` · <lane> — <claim> · dropped because <what the verifier read or ran>

</details>

---

## ⏭️ Not checked

- <Anything skipped and why: `--quick`, diff truncated, package not built, database not queried, a lane that did not return, a checklist file skipped without a lane reason.>
````

## Notes for the writer

- The summary blockquote is the whole report for a reader in a hurry. Make it earn that.
- Anchors use the head commit's line numbers. Say so once in the Findings intro if the PR is likely to move under review.
- Do not pad. A clean PR gets a short report with a real "Verified clean" section, not manufactured nits.
- Never restate a bot's finding as yours. A confirmed one credits the bot in its finding ("Bugbot flagged this; confirmed"), and every bot comment lands in 🤖 Bot comments with its disposition.
