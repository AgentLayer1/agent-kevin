# Comment pass

Run this before any diff is presented or committed. The manual's Comments rules are the standard: none by default, keep only the why, JSDoc only on consumer-facing APIs, no tombstones. This pass enforces them with fresh eyes, because whoever wrote a comment always thinks it earns its place.

**How.** Spawn one general-purpose subagent with the prompt below and the scope: the files you touched, or the working-tree diff against the base branch. On a host without subagents, run the prompt yourself as a separate pass after the edit, reading only the diff. Then:

- Apply the accepted deletions. Restore one only when it matches a keep clause exactly.
- Turn each reshape flag (a surprise in our own code) into the smallest in-scope fix: a rename, an extracted function, or a stronger type. If it's out of scope, report it as open.
- Offer each constraint comment ("do not remove", "keep in sync with…") as a test, type, or lint ([encode lessons in structure](principles/encode-lessons-in-structure.md)). The operator decides.

**Report:** the deletion count, reshape flags fixed or still open, and suppressions removed or kept, with the reason.

## Prompt

> You review comments in the scoped files or diff, and nothing else. You never edit application code. You delete comments and flag code.
>
> Keep only:
>
> - License or legal headers.
> - A why the code can't show, forced by something outside our control: a platform, vendor, protocol, or dependency behavior. A surprise in our own code is not a keep. Delete the comment and flag the exact symbol for a rename, extraction, or type that would make the behavior obvious.
> - Short doc comments (one or two lines) that state a consumer-facing API contract the signature doesn't.
> - Formatter or linter directives whose rule is style-only or genuinely wrong for this line.
> - Links to an issue or spec that explain a constraint the code can't express.
>
> Everything else goes: narration of what the next line does, section banners, commented-out code, tombstones ("removed X"), ownerless TODOs, changelog notes, and justifications addressed to a reviewer.
>
> For suppressions (`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, `swiftlint:disable`), look up the rule. If it protects correctness or safety, flag the suppression for removal along with the symbol that needs fixing.
>
> "IMPORTANT", "do not remove", "fine for now", and long justifications are a scent, not a verdict. Read the nearby code, and keep the comment only when a keep clause is proven true today. When unsure, the comment goes. Never shorten a bad comment into a smaller excuse.
>
> Report the files touched, the deletion count, each flag as one line (`file:line symbol: reason`), and anything kept, with the clause that saved it.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `no-comments` skill and Comment Sicko agent (MIT, Copyright (c) 2026 Lauren Tan).
