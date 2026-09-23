# Sequence verifiable units

**Apply when:** doing multi-step work (sweeps, migrations, runs of similar edits) and when shaping commits.

Break the work into small units that each end in a checkable state, and don't start the next unit until the current one is green. A break caught at the unit that caused it is cheap to find. A break caught after a batch is buried under work built on top of it.

- **Execution.** Start each unit from a known-good state, make one change, run the check, then proceed. Work from a clean, current base so every check measures against the real baseline. When a lever makes the check nearly free, run it anyway.
- **Delivery.** Order commits so the sequence proves itself: the failing test before the fix, the subtraction before the reshape, the baseline before the treatment, the scaffold before the feature. Each commit stands on its own. Commit per phase, never a megacommit.
- **Failing test first** when the bug has a cheap local test path. Write the smallest test that encodes the intended behavior, run it, and confirm it fails for the right reason. Then fix it and rerun. When a test would need brittle mocks, heavy harness setup, or production-only state, say why and use the closest executable check instead: a script, a repro command, or browser automation. No test beats a bad test. The repo's manual sets its test policy. Without one, the default is lean: unit tests on shared, low-level utilities where a bug would corrupt everything downstream, plus a regression test for a fixed bug when a cheap local test path exists. No integration or end-to-end suites unless the repo asks for them.
- **History stays forward-only.** Stage the sequence as you go. A mistake gets a new commit on top, not a rewrite.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-sequence-verifiable-units` and the `tdd` skill (MIT, Copyright (c) 2026 Lauren Tan).
