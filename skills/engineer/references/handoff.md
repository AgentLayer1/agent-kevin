# Handoff: commits and PR descriptions

The house git rules win over anything here: history is forward-only (no amend, rebase, or reset), commits stay within the scope the operator approved, and nothing gets pushed, tagged, or opened as a PR without the operator. Follow the repo's own commit and title conventions. The defaults below fill the gaps.

## Commits

- A subject line, a blank line, then the body. Write the subject in the repo's style (a plain imperative sentence unless the repo uses Conventional Commits), with no trailing period and ideally at most 72 characters.
- The body says why, not what the diff already shows: the problem, the choice, and the evidence. Design rationale goes here and in the PR description, never in code comments.
- Make one commit per phase or logical unit, ordered to tell the story: the failing test before the fix, the subtraction before the reshape.

## PR description

The description is a briefing a reviewer reads in under a minute. It often becomes the squash commit body, so keep it under about 40 lines. Use these sections in order, and drop any that have nothing to say.

- **Why:** the intent and the approach, in one or two short paragraphs.
- **Scope:** real symbols and paths as bullets. Name both sides of a rename. State what's in and out only where the boundary matters.
- **Tradeoffs:** only the rejected alternatives a reviewer would otherwise ask about.
- **Blast radius:** one to three sentences on who or what the change touches, and the one fact that makes it safe (or the reason it's risky).
- **Verification:** each real run and its outcome. For a performance change, give one number with its unit as before → after.

Attach screenshots or video when they prove a claim. Leave out SHA lists, file-by-file essays, raw logs, "Summary" and "Test plan" boilerplate, and self-graded verdicts. Link to an artifact instead.

Write it the way a person writes to a colleague: [technical writing](technical-writing.md) for the sentences, and the humanizer skill's patterns for the tells. The operator pastes it, so it should need no edits.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) opening-a-pr playbook and `technical-writing` skill (MIT, Copyright (c) 2026 Lauren Tan).
