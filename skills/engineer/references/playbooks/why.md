# Why it is like this

**You own a cited, calibrated answer** to "why does X work this way", "why did we pick Y", a regression's history, or where a threshold came from. For mechanics, use [how](how.md). Be a careful investigator: honest about what the record says and what you are inferring.

## Anchor, then search every source

1. **Pin the target and the question.** If the target is vague, state your reading from the conversation and proceed; the operator can redirect.
2. **Anchor in code:** file paths and line ranges, key symbols, `git blame -L <start>,<end> <file>`, `git log --follow -p -- <file>`, the last commits touching it, and the PR numbers in their subjects. Pull PR bodies and review threads (the GitHub tools or `gh pr view`).
3. **Search every evidence source available, in parallel,** one subagent per source:
   - **Source control:** commits, PRs, reviews, code comments, tests. Always.
   - **The home's own record,** which few agents have: `knowledge/raw/sessions/` (the find-session skill searches it), `knowledge/memory/` decisions and their archives, project READMEs, and task threads. The session that made a change often says why in plain words.
   - **Any connected tracker, docs, chat, observability, or error-tracking tools.** Name each one you had no access to.
   - For defensive code (null checks, retries, timeouts, rate limits, feature flags), look specifically for the incident that motivated it.
4. **Record the null results.** "Searched X for Y, found nothing" is a finding. Skip a source only when it is unavailable or provably irrelevant, and say which.

## Calibrate every claim

| Tier | Meaning | Phrasing |
|---|---|---|
| Direct | Someone wrote down why (PR body, ticket, comment, doc, a session) | "This exists because X", with the citation |
| Supported | Several indirect sources converge | "The evidence points to X: A, B, C" |
| Inferred | A reasonable reading, nothing explicit | "Likely", "appears to", with the inference chain |
| Speculative | Plausible, thin evidence, other stories fit | "One possibility is X, but no direct evidence" |
| Unknown | Searched and not found | Say exactly what was searched |

- **The code is not evidence of its own intent.**
- **"Because", "was designed to", "the team decided"** need a citation beside them.
- **Surface contradictions** instead of picking the tidier story.
- **A hypothesis embedded in the question** is one candidate to check, not a conclusion to confirm.
- **Avoid "obviously", "clearly", and "just".** They usually hide uncertainty.
- **Don't retrofit a clean rationale onto messy history,** and don't turn an absence of evidence into evidence of absence.

## Output

1. **The question**, restated.
2. **The code**: the file, the lines, and the symbols it covers.
3. **What we found** (Direct and Supported, each cited).
4. **What we can reasonably infer.**
5. **Competing hypotheses**, when the record fits more than one story.
6. **What we don't know**, naming each specific gap. An empty section is suspicious.
7. **Sources consulted**: one line per source, including the empty and unavailable ones.
8. **A one-line confidence summary.**

When the question precedes a change, end with a **Preserve / Change / Avoid / Risk** list for planning it.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `why` skill and its epistemics reference (MIT, Copyright (c) 2026 Lauren Tan).
