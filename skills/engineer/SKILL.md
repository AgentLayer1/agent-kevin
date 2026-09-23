---
name: engineer
description: >
  Engineering rigor for code work in a repository: fixing a bug, building or changing a feature,
  refactoring or simplifying, a performance problem, prototyping a design choice, or tracing how
  code works before changing it. Picks the matching playbook, applies the engineering principles
  (prove it works, fix root causes, test behavior, model the domain), and runs a comment pass
  before a diff is shown. Triggers on "fix", "build", "refactor", "simplify", "why is this slow",
  "how does X work".
---

# Engineer

The working method for code: a playbook per kind of task, principles the playbooks lean on, and three checks that run every time. Prove it on the real artifact, label every claim, and run the comment pass before anyone sees the diff.

## Start

1. Read the repo's `AGENTS.md` and, when it has one, its `.claude/CLAUDE.md`. The repo's build loop and conventions beat anything here, and the home manual's Engineering Standards beat the playbooks.
2. Match the task to a playbook, open it, and copy its steps into your todo list verbatim. A step you choose to skip stays in the list as `skip: <reason>`.
3. Read a principle's file before applying it. Name a principle in your reply only when it changed a decision, and name the decision it changed.

## Playbooks

| Task | Playbook |
|---|---|
| A read-only question: how does X work, why is Y like this, should we do A or B | [investigation](references/playbooks/investigation.md) |
| A defect to reproduce, root-cause, and fix | [bug fix](references/playbooks/bug-fix.md) |
| New or changed behavior | [feature](references/playbooks/feature.md) |
| Same behavior, better structure: refactor, simplify, clean up, "is this over-engineered?" | [refactoring](references/playbooks/refactoring.md) |
| A measured slowness, or pushing a metric toward a target | [performance](references/playbooks/perf.md) |
| A fork you can settle by building a throwaway and looking at it | [prototype](references/playbooks/prototype.md) |

Cross-cutting references:

- Code that crosses a function boundary, or a shape that isn't obvious: [design](references/design.md).
- Before any diff is presented: [comment pass](references/comment-pass.md).
- Commit messages and PR descriptions: [handoff](references/handoff.md).
- A second model on contested work: the adversarial-review skill. Someone else's PR: the pr-review skill.

## Every time

- Name the data shape before writing logic.
- Before asking the operator a "which approach" question, classify it. If the answer is a fact you could observe by running something (behavior, timing, layout, output), run it or prototype it. Ask only for product or preference calls that no experiment settles.
- Every claim carries its evidence or its label in the same sentence: measured, inferred, or guess. Never hand the operator a check you could run.
- "Done" means proven on the real artifact, with the level you reached on the [proof ladder](references/principles/prove-it-works.md) stated.
- Verify delegated work from its diff and output, never from its summary.

## Principles

| Principle | Apply when |
|---|---|
| [Subtract first](references/principles/subtract-first.md) | Sizing a diff, refactoring, or tempted to add a layer, option, or abstraction |
| [Foundational thinking](references/principles/foundational-thinking.md) | Choosing core types, sequencing scaffold against features, folding in a new requirement |
| [Model the domain](references/principles/model-the-domain.md) | Stateful logic, heavy branching, or a shape assumption repeated across files |
| [Type system discipline](references/principles/type-system-discipline.md) | Designing types or a signature in any typed language |
| [Boundary discipline](references/principles/boundary-discipline.md) | Wiring validation, error handling, or framework adapters |
| [Minimize reader load](references/principles/minimize-reader-load.md) | Code that's hard to trace, or before adding a layer or state |
| [Make operations idempotent](references/principles/make-operations-idempotent.md) | Commands, migrations, syncs, or loops that meet crashes and retries |
| [Separate before serializing](references/principles/separate-before-serializing.md) | Concurrent actors that might write the same file, branch, or key |
| [Migrate, then delete](references/principles/migrate-then-delete.md) | A new internal API while old callers exist, or a phased rewrite |
| [Exhaust the design space](references/principles/exhaust-the-design-space.md) | A novel interaction or architecture with more than one viable shape |
| [Build the lever](references/principles/build-the-lever.md) | Non-trivial edits, migrations, analyses, or checks |
| [Prove it works](references/principles/prove-it-works.md) | Before saying done, and behind any claim you didn't observe |
| [Fix root causes](references/principles/fix-root-causes.md) | Debugging, or about to add a guard; two fixes on one premise failed |
| [Sequence verifiable units](references/principles/sequence-verifiable-units.md) | Multi-step work, and shaping commits |
| [Test behavior, not implementation](references/principles/test-behavior-not-implementation.md) | Writing, reviewing, or keeping a test |
| [Encode lessons in structure](references/principles/encode-lessons-in-structure.md) | The same instruction or correction for the second time |
| [Guard the context window](references/principles/guard-the-context-window.md) | Big outputs, long files, fan-out planning |
| [Experience first](references/principles/experience-first.md) | Product, UX, API-shape, or scope tradeoffs |

## Reply

Lead with what changed for whoever consumes the work (the user of the app, the caller of the API), then what the next maintainer inherits. Then give the playbook's reply contract. Keep it short, and keep every section the playbook names.

---

Principles and playbooks adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT, Copyright (c) 2026 Lauren Tan).
