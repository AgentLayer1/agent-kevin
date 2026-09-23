---
name: engineer
description: >
  Engineering rigor for code work in a repository: fix a bug, build or change a feature, refactor
  or simplify, chase a slowdown or hillclimb a metric, prototype a choice, explain how code works
  or why it is shaped that way, check a change's blast radius, architect a design, run an arena or
  swarm, interrogate a branch, or drive a long run to a finish line. Picks the playbook, applies 23
  engineering principles (laziness protocol, prove it works, fix root causes, model the domain…),
  and runs a comment pass before a diff is shown. Triggers on "fix", "build", "refactor",
  "simplify", "why is this slow", "how does X work", "why is X like this", "architect this",
  "blast radius", "interrogate".
---

# Engineer

The working method for code: a playbook per kind of task, principles the playbooks lean on, and three checks that run every time. Prove it on the real artifact, label every claim, and run the comment pass before anyone sees the diff.

## Start

1. Read the repo's `AGENTS.md` and, when it has one, its `.claude/CLAUDE.md`. The repo's build loop and conventions beat anything here, and the home manual's Engineering Standards beat the playbooks.
2. Match the task to a playbook, open it, and copy its steps into your todo list verbatim. A step you choose to skip stays in the list as `skip: <reason>`. A new task in a long conversation gets re-matched, not folded into the last playbook.
3. Read a principle's file before applying it. Name a principle in your reply only when it changed a decision, and name the decision it changed.

## Playbooks

| Task | Playbook |
|---|---|
| A read-only question, or a choice between options | [investigation](references/playbooks/investigation.md) |
| How does X work; where should this live | [how](references/playbooks/how.md) |
| Why is X like this; where did this number come from | [why](references/playbooks/why.md) |
| A defect to reproduce, root-cause, and fix | [bug fix](references/playbooks/bug-fix.md) |
| New or changed behavior | [feature](references/playbooks/feature.md) |
| Same behavior, better structure: refactor, simplify, clean up, "is this over-engineered?" | [refactoring](references/playbooks/refactoring.md) |
| A measured slowness | [performance](references/playbooks/perf.md) |
| Push one metric toward a target | [hillclimb](references/playbooks/hillclimb.md) |
| A live symptom (leak, spin, glitch) to diagnose | [runtime forensics](references/playbooks/runtime-forensics.md) |
| A captured profile, trace, or snapshot to diagnose | [trace forensics](references/playbooks/trace-forensics.md) |
| Pixel-exact equivalence between two UIs | [visual parity](references/playbooks/visual-parity.md) |
| What could this change break elsewhere | [blast radius](references/playbooks/blast-radius.md) |
| A fork you can settle by building a throwaway and looking | [prototype](references/playbooks/prototype.md) |
| Large, cross-cutting, or reviewed-after-stepping-away work no other playbook fits | [figure it out](references/playbooks/figure-it-out.md) |
| Keep going until a finish line | [autonomous run](references/playbooks/autonomous-run.md) |
| Stop cleanly so a later session can resume | [pause safely](references/playbooks/pause-safely.md) |
| Take over a prior session's in-flight work | [session pickup](references/playbooks/session-pickup.md) |
| Reclaim disk from worktrees and simulators | [worktree cleanup](references/playbooks/worktree-cleanup.md) |
| Write or edit a `SKILL.md` | [authoring a skill](references/playbooks/authoring-a-skill.md) |
| Test whether a skill or prompt change changes behavior | [eval](references/playbooks/eval.md) |
| Give a repo a scripted way to prove the app works | [verification skill](references/playbooks/verification-skill.md) |

Cross-cutting references:

- Code that crosses a function boundary, or a shape that isn't obvious: [architect](references/architect.md).
- N competing attempts, then pick and graft: [arena](references/arena.md). N workers over slices or a race: [swarm](references/swarm.md).
- Several reviewers attacking a change: [interrogate](references/interrogate.md). A second model on your work: the adversarial-review skill. Someone else's PR: the pr-review skill.
- Before any diff is presented: [comment pass](references/comment-pass.md).
- Commit messages and PR descriptions: [handoff](references/handoff.md) and [technical writing](references/technical-writing.md).
- A reviewable trail for long or unattended work: [decision log](references/decision-log.md).

## How much rigor

Most changes need none of the heavy tools. A rough ladder:

- A small, finished change you're unsure about: [interrogate](references/interrogate.md) or [blast radius](references/playbooks/blast-radius.md) alone.
- A change that crosses function boundaries or moves ownership: [architect](references/architect.md), which brings an [arena](references/arena.md).
- A standalone decision where independent attempts help (a name, a format, an algorithm): an [arena](references/arena.md) directly.
- A coverage matrix, parallel checks, or a race with declared arms: a [swarm](references/swarm.md).
- A contested design that's expensive to reverse: architect, then interrogate (or a second model) before shipping.

## Every time

- Name the data shape before writing logic.
- Before asking the operator a "which approach" question, classify it. If the answer is a fact you could observe by running something (behavior, timing, layout, output), run it or prototype it. Ask only for product or preference calls that no experiment settles.
- Every claim carries its evidence or its label in the same sentence: measured, inferred, or guess. Never hand the operator a check you could run.
- "Done" means proven on the real artifact, with the level you reached on the [proof ladder](references/principles/prove-it-works.md) stated.
- A broken skill or check you hit mid-task gets fixed as its own change. Don't block on it and don't silently work around it.

## Delegation

- You own every subagent's work. Review its diff and output yourself and write your own summary; never pass a "done" through.
- Brief with file pointers, the scope, the named data shape, and the success criterion, not pasted context.
- A resumed or interrupted subagent can drop directives. Fire a fresh one with consolidated scope rather than chaining interrupts.
- A second opinion is the same prompt against a different model. Agreement between models is high signal.
- Parallel writers each get their own worktree or output directory.

## Prompting pitfalls

- A duration is not a finish condition. "Four hours on this" gives nothing to check; "until the checker reports zero old callers" does.
- Say the goal and the constraints, not the ceremony. Naming a sequence of skills reorders steps the playbook already sequences.
- "Don't change any code yet" pins a request to investigation.

## Principles

**Core**

| Principle | Apply when |
|---|---|
| [Laziness protocol](references/principles/laziness-protocol.md) | Sizing a diff, refactoring, or tempted to add a layer, abstraction, or threaded signal |
| [Foundational thinking](references/principles/foundational-thinking.md) | Choosing core types, sequencing scaffold against features, asking what concurrent actors share |
| [Redesign from first principles](references/principles/redesign-from-first-principles.md) | Integrating a new requirement into an existing design |
| [Attack the premise](references/principles/attack-the-premise.md) | Two or more fixes sharing one premise have failed the same check |
| [Subtract before you add](references/principles/subtract-before-you-add.md) | Sequencing an addition, refactor, or rewrite |
| [Minimize reader load](references/principles/minimize-reader-load.md) | Code that's hard to trace, or before adding a layer or state |
| [Outcome-oriented execution](references/principles/outcome-oriented-execution.md) | A planned rewrite or migration with phase boundaries |
| [Experience first](references/principles/experience-first.md) | Product, UX, API-shape, or scope tradeoffs |
| [Exhaust the design space](references/principles/exhaust-the-design-space.md) | A novel interaction or architecture with more than one viable shape |
| [Build the lever](references/principles/build-the-lever.md) | Any non-trivial edit, migration, analysis, or check |

**Architecture**

| Principle | Apply when |
|---|---|
| [Model the domain](references/principles/model-the-domain.md) | Stateful logic, heavy branching, or a shape assumption repeated across files |
| [Boundary discipline](references/principles/boundary-discipline.md) | Wiring validation, error handling, configuration, or framework adapters |
| [Type system discipline](references/principles/type-system-discipline.md) | Designing types or a signature in any typed language |
| [Make operations idempotent](references/principles/make-operations-idempotent.md) | Commands, migrations, syncs, or loops that meet crashes and retries |
| [Migrate callers, then delete legacy APIs](references/principles/migrate-callers-then-delete-legacy-apis.md) | A new internal API while old callers exist |
| [Separate before serializing shared state](references/principles/separate-before-serializing-shared-state.md) | Concurrent actors that might write the same file, branch, or key |

**Verification**

| Principle | Apply when |
|---|---|
| [Prove it works](references/principles/prove-it-works.md) | Before saying done, and behind any claim you didn't observe |
| [Fix root causes](references/principles/fix-root-causes.md) | Debugging, or about to add a guard |
| [Sequence verifiable units](references/principles/sequence-verifiable-units.md) | Multi-step work, shaping commits, and the TDD cadence |
| [Test behavior, not implementation](references/principles/test-behavior-not-implementation.md) | Writing, reviewing, or keeping a test |

**Delegation**

| Principle | Apply when |
|---|---|
| [Guard the context window](references/principles/guard-the-context-window.md) | Big outputs, long files, fan-out planning |
| [Never block on the human](references/principles/never-block-on-the-human.md) | Tempted to ask "should I do X?" about reversible work |

**Meta**

| Principle | Apply when |
|---|---|
| [Encode lessons in structure](references/principles/encode-lessons-in-structure.md) | The same instruction or correction for the second time |

## Reply

Lead with what changed for whoever consumes the work (the user of the app, the caller of the API), then what the next maintainer inherits. Then give the playbook's reply contract. Keep it short, and keep every section the playbook names.

---

Principles, playbooks, and references adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT, Copyright (c) 2026 Lauren Tan).
