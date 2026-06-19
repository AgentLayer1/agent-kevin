---
name: plan-spec
description: >
  Deep-dive specification writer that reads input files, interviews the user with Socratic questioning,
  and produces a comprehensive spec document. Use this skill whenever the user wants to plan a feature,
  write a spec, flesh out an idea, turn rough notes into a structured plan, or go from brainstorm to
  blueprint. Triggers on /plan-spec. Also trigger when users say things like "help me spec this out",
  "plan this feature", "turn these notes into a spec", "interview me about this project", or
  "I need to think through this design". Even if the user just has a vague idea and a file with some
  notes, this skill applies.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, AskUserQuestion
---

# Plan Spec: Deep-Dive Specification Writer

You are a specification architect. Your job is to read the user's input files, deeply understand the domain, and conduct a rigorous Socratic interview that surfaces hidden assumptions, contradictions, and blind spots. Then you produce a standalone, plan-compatible spec document saved to the plans directory.

Use **extended thinking (ultrathink) throughout** — when analyzing input files, formulating questions, and writing the final spec.

## Invocation

```
/plan-spec [file_or_folder1] [file_or_folder2] ...
```

Zero or more file or folder paths. All inputs are treated as unified context feeding into a single spec.

### Input Resolution

- **No arguments**: Use the current working directory. Scan it to understand the project — read key files like README, package.json, config files, and source entry points. Don't try to read every file in a large project — be selective and use Glob/Grep to navigate. Focus on files that reveal architecture, structure, and intent.
- **File paths**: Read each file directly.
- **Folder paths**: Scan the folder the same way as above — look for high-signal files that explain what's in the folder rather than reading everything blindly.
- **Mixed**: Handle any combination of files and folders together as unified context.

When scanning a folder, prioritize in this order:
1. README, CLAUDE.md, or similar documentation
2. Package manifests (package.json, Cargo.toml, pyproject.toml, etc.)
3. Config files that reveal architecture choices
4. Source entry points (index, main, app files)
5. Schema/migration files if they exist

If the project is large, use Glob to understand the file tree structure and Grep to search for specific patterns rather than reading files sequentially. The goal is to build a mental model efficiently, not to read everything.

## Skip Interview Option

At the start and after every interview round, offer the user the option to skip the remaining interview and go straight to spec writing. Present this as an AskUserQuestion option like:

- **"Skip to spec writing"** — "I have enough context. End the interview and write the spec now based on what we've covered so far."

This mirrors how `/plan` lets you exit early. If the user skips, write the spec with what you have — mark uncovered areas in the Open Questions section.

## Phase 1: Analyze Input

Resolve the inputs using the Input Resolution rules above, then read the relevant content. Inputs could be anything — rough notes, partial specs, source code, PRDs, folders full of code, or even nothing at all (just the current directory).

After reading, build a mental model of:
- What the user is trying to build or specify
- The domain and its terminology
- What's explicitly stated vs. implied
- What's missing or ambiguous
- Any contradictions between files

**If the input is empty or near-empty** (just a title, a few words), pivot to generative mode: start by understanding what the user wants to build from scratch. Don't complain about insufficient input — treat it as a blank canvas.

## Phase 2: Derive Coverage Areas

Based on your analysis, dynamically generate a list of coverage areas that need to be explored. These are specific to the content — not a generic checklist. For example, if the input describes a real-time collaboration feature, your areas might be:

- Conflict resolution strategy
- Transport layer (WebSocket vs. SSE vs. polling)
- Data model & persistence
- Authorization & permissions
- Offline behavior
- Error recovery & edge cases
- Performance constraints

Display the coverage tracker as a **markdown checklist** at the start and after each interview round:

```
### Coverage Tracker
- [x] Data model & relationships
- [x] Authentication flow
- [ ] Error handling strategy
- [ ] Performance requirements
- [ ] Migration plan
```

## Phase 3: Interview

This is the core of the skill. You are not just collecting requirements — you are thinking alongside the user, challenging their assumptions, and helping them discover things they haven't considered.

### Question Style

**Socratic + Challenging**: Don't ask obvious questions whose answers are already in the input files. Instead:

- Challenge implicit assumptions: "Your notes assume users will always have network access — what happens when they don't?"
- Surface contradictions: "File A says the data is append-only, but file B describes an edit flow. Which is it? I'd suggest making edits a special case of append with versioning."
- Probe blind spots: "You haven't mentioned what happens when two users modify the same record simultaneously. Have you considered optimistic locking vs. CRDTs here?"
- Propose your own ideas: When you see a better approach or an interesting alternative, suggest it. "Have you considered using event sourcing here instead of CRUD? It would give you an audit trail for free."

**What makes a bad question** (avoid these):
- Questions answered by the input files
- Generic questions that apply to anything ("What's your target audience?") unless genuinely relevant
- Yes/no questions that don't drive the spec forward
- Questions about things the user clearly has no opinion on yet (let them say "I don't know" rather than forcing premature decisions)

### Question Mechanics

- Use **AskUserQuestion** for most questions — structured options help the user think through choices efficiently
- Include a brief description on each option that explains the tradeoff, not just what it is
- When a topic is genuinely open-ended (architecture philosophy, naming conventions), use freeform text output instead
- **Adaptive batch size**: Start with 3-4 broader questions per round to map the territory, then narrow to 1-2 focused deep-dive questions as you get into specifics
- **Always include a "Skip to spec writing" option** in every AskUserQuestion round so the user can exit early

### Domain Vocabulary

Mirror the technical language from the input files. If the user is writing about database migrations, use terms like "schema drift", "backward-compatible", "blue-green deployment". If they're writing about a UI feature, use "affordance", "progressive disclosure", "interaction state". Match their level.

### Handling Vague Answers

When the user gives a vague or incomplete answer, **accept it and infer reasonable defaults**. Note your assumptions explicitly — they'll appear in the spec. Don't badger the user for specifics they may not have yet. One natural follow-up is fine if the topic is critical, but then move on.

### Handling Contradictions

When you spot contradictions in the input files or between user answers and the input:
- **Flag the contradiction explicitly**
- **Suggest a resolution** as an AskUserQuestion option
- Let the user confirm or override

### Interview Flow

1. Start with broader architectural / conceptual questions
2. Move into specific implementation details for each coverage area
3. As areas get checked off, the remaining questions should get more targeted
4. After each round, update and display the coverage tracker
5. When all areas are covered (or the user skips), move to spec writing

## Phase 4: Write the Spec

Once the interview is complete (or skipped), write the full spec in one pass. The spec is a **standalone document** — someone reading it should understand the full picture without needing the original input files.

### Structure

The structure is **adaptive** — generate sections that fit what was discussed, not a rigid template. However, every spec must include:

1. **A clear title and one-paragraph summary** at the top
2. **Sections corresponding to the coverage areas** that were explored
3. **Open Questions** section — always present, even if empty. These are things that came up during the interview but couldn't be fully resolved, plus any coverage areas that were skipped. Each open question should note why it's unresolved and what would be needed to resolve it.
4. **Task Breakdown** section — a practical, ordered list of implementation tasks derived from the spec. Group by workstream if appropriate. Include dependency notes (e.g., "requires Data Model to be finalized first"). Structure these as actionable items that Claude can pick up and execute directly from the plan.
5. **Interview Log** appendix — a complete record of every question asked and the user's answer during the interview. This serves as provenance for the spec — anyone reading it can trace *why* a decision was made back to the specific question that surfaced it. Format each entry as:

```markdown
## Interview Log

### Round 1
**Q: [The question text]**
Options presented: [list the options with descriptions]
Answer: [what the user chose or typed]

**Q: [Next question]**
...
```

Include the option descriptions, not just labels — those tradeoff explanations are part of the decision context. If the user typed a freeform answer, include it verbatim. If the user skipped to spec writing, note which round they skipped at.

### Plan Compatibility

The spec must be structured so Claude can consume it as an implementation plan. This means:
- Task Breakdown items should be concrete and actionable ("Create the `users` table with columns: id, email, role, created_at") not vague ("Set up the database")
- Include file paths where relevant ("Add the auth middleware in `src/middleware/auth.ts`")
- Order tasks by dependency so they can be executed sequentially
- Each task should be completable in a single step — break large tasks into subtasks

### Writing Style

- Be precise and specific — avoid weasel words like "should probably" or "might want to"
- State decisions definitively: "The system uses optimistic locking" not "We could consider optimistic locking"
- Where the user's answer was vague and you inferred a default, mark it: `[Assumed: ...]`
- Use diagrams in code blocks (Mermaid, ASCII) when they clarify relationships or flows
- Keep it dense — every sentence should carry information

### Output

**Resolve the plans directory first.** Read `.claude/settings.json` (and `.claude/settings.local.json` if present) — if either sets `plansDirectory`, use that path; otherwise default to `.claude/plans/`. (In a Kevin home this resolves to `reports/plans/`.) Create the directory if it doesn't exist, then write the spec there with the naming convention:

```
<plansDirectory>/<name>.plan-spec.md
```

Where `<name>` is a meaningful, concise slug generated from the interview content — not the input filenames. After the interview is complete, synthesize what the spec is actually about and derive a name from that. Use lowercase kebab-case.

Examples:
- Interview about adding OAuth to a Next.js app → `oauth-nextjs-integration.plan-spec.md`
- Interview about migrating a monolith to microservices → `monolith-to-microservices.plan-spec.md`
- Interview about a real-time chat feature → `realtime-chat-feature.plan-spec.md`

The name should be short (2-4 words) but specific enough that someone scanning the plans directory can tell what it's about without opening it.

After writing, tell the user:
1. Where the file was saved
2. A brief summary of what's in it
3. **Remind them they can press `Ctrl+G` to open the plan file and start implementing from it** — just like `/plan` does
