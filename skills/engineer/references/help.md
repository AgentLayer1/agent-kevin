## 🛠️ engineer · what it can do

Ask in plain words, or name the playbook: `/engineer <playbook> <target>`. It reads the repo's `AGENTS.md` first, follows the playbook step by step, and proves the result on the real artifact before calling it done.

### 🔍 Understand

| Ask | Playbook | You get |
|---|---|---|
| "how does the retry queue work?" | **how** | Entry point to exit, the key types, where things live, the gotchas |
| "why is this timeout 30s?" | **why** | Git history, PRs, and past sessions as evidence, every claim labeled |
| "should we use X or Y?" | **investigation** | A cited answer, verdict first, no code changed |
| "what could this diff break?" | **blast radius** | The one fact it's safe because of, proven by running code |

### 🔧 Change code

| Ask | Playbook | You get |
|---|---|---|
| "the export writes two rows after a retry" | **bug fix** | Reproduced first, root cause found, a failing test before the fix when cheap |
| "add CSV export to reports" | **feature** | The data shape named first, then the real feature path proven |
| `/engineer simplify src/billing` | **simplify** | An audit against eight criteria, findings ranked, nothing changed until you pick |
| "refactor the parser into stages" | **refactoring** | Behavior pinned first, removals before reshapes, equivalence proven |
| "try both layouts and show me" | **prototype** | A throwaway behind one switch, then a recommendation |

### ⚡ Speed and forensics

| Ask | Playbook | You get |
|---|---|---|
| "why is startup slow?" | **performance** | A measured baseline, one change at a time, before/after numbers |
| "get p95 under 200ms" | **hillclimb** | Iterations toward a target metric, each kept or reverted on evidence |
| "the app leaks memory after an hour" | **runtime forensics** | The live signal captured and the mechanism proven |
| "read this profile / trace" | **trace forensics** | The hot frame, attributed to source |
| "match the old screen pixel for pixel" | **visual parity** | A baseline, then an image diff driven to zero |

### 🏗️ Design and review

| Ask | Reference | You get |
|---|---|---|
| "architect the import pipeline" | **architect** | Usage first, designed twice, red flags checked, a rationale |
| "try three approaches and pick one" | **arena** | Parallel attempts, a rubric, a cross-judged winner |
| "check every endpoint for X" | **swarm** | Workers over slices, one merged report |
| "interrogate this branch" | **interrogate** | Several reviewers, findings sorted into act, consider, noted, dismissed |

A second model on your own work is the `adversarial-review` skill; a teammate's PR is `pr-review`.

### 🏃 Long and multi-session work

| Ask | Playbook | You get |
|---|---|---|
| "migrate all callers to the new API" | **figure it out** | A designed workflow, a checkable definition of done, a decision log |
| "keep going until the checker is clean" | **autonomous run** | Runs to a finish line you can check, not a duration |
| "pause here" | **pause safely** | A resume note, nothing half-applied |
| "pick up where that session left off" | **session pickup** | The prior trail found and treated as the source of truth |

### 🧰 Skills and verification

| Ask | Playbook | You get |
|---|---|---|
| "write a skill for X" | **authoring a skill** | Frontmatter and links validated, the catalog test green |
| "did this prompt change help?" | **eval** | Blinded candidates and a judge |
| "give this repo a way to prove the app works" | **verification skill** | A `verify-<app>` skill with a feature map, run once before handover |

### 🧭 Steer by principle

Name one and it changes the decision it governs: "apply the laziness protocol", "prove it works on the device".

- **Core** · laziness protocol · foundational thinking · redesign from first principles · attack the premise · subtract before you add · minimize reader load · outcome-oriented execution · experience first · exhaust the design space · build the lever
- **Architecture** · model the domain · boundary discipline · type system discipline · make operations idempotent · migrate callers then delete legacy APIs · separate before serializing shared state
- **Verification** · prove it works · fix root causes · sequence verifiable units · test behavior not implementation
- **Delegation** · guard the context window · never block on the human
- **Meta** · encode lessons in structure

### ✅ Every time

The repo's `AGENTS.md` first · the data shape before logic · every claim labeled measured, inferred, or guess · "done" proven on the real artifact · a comment pass before you see a diff.

> "Don't change any code yet" keeps any request read-only. `/engineer help` shows this card.
