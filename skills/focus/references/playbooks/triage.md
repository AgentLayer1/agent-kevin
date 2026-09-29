# Triage — which session needs you (`/focus triage [scope]`)

When the operator asks "what should I tend to / which session needs me", or runs
`/focus triage`, the question changes from *where am I* to *where should I go*. The
radar's digest and report are replaced by a ranked interview. Everything comes from the
session JSON already gathered — no other data source. Triage is ephemeral — **no report**.

Run Steps 1–2 of the [where-am-i](where-am-i.md) playbook (gather, then write the summaries),
then continue here.

**Scope filter.** A remaining argument (e.g. `/focus triage acme`) keeps only
sessions whose `cwd` contains it, case-insensitively. No matches → say so and triage
the full set rather than returning empty-handed.

**Rank.** Order candidates by what most needs the operator, blending:

1. **Decision-pending** — `last_assistant_text` ends by asking the operator something
   ("Want me to…?", numbered options, an explicit question). The agent is stalled on a
   human call; oldest first.
2. **Importance** — weigh against the memory already in context: hard deadlines, P0/P1
   tasks, day-job precedence. A session tied to a dated obligation outranks a code
   review that can wait.
3. **Momentum** — a session that just finished (agent reported done) needs a look
   before its context goes cold; long-idle exploratory threads rank last.

Batch duplicates: several sessions on one work-stream (same branch or topic) are ONE
candidate — name the lead session and note the others in its description.

**Interview.** First render the ranked candidates as a table so the operator sees the
whole field before choosing — short cells, reasoning stays in the interview:

```
## 🩺 Triage · 3 of 11 need you

| # | Session | Why now | Tending |
|---|---------|---------|---------|
| 1 | ❓ Vendor security questionnaire | answers drafted, due Aug 14 | review & approve |
| 2 | ❓ Invoice export PR | asked which option 46m ago | answer its question |
| 3 | ✅ Radar feature | done, context going cold | skim & close out |
```

Then present the same top 3–4 via AskUserQuestion: label = short session name,
description = *why now* (one sentence: what it's waiting on, any deadline) + *what
tending means* (answer its question / review and approve / kick a stall / close it out).

**Deliver.** On selection, give the `claude --resume <full-session-id>` command and a
one-line brief of what to do on arrival (the specific question to answer or thing to
review). Never send input to the chosen session yourself — triage delivers the operator
to the work, it doesn't do the work.

Triage ranks sessions, not the day. When the operator sounds overwhelmed ("too much going
on", "I'm lost"), close with one line pointing at the plan: the dashboard's Today → Focus view, and the
[plan](plan.md) playbook (`/focus plan`) to cut today to three.
