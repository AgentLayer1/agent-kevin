# Fix root causes

**Apply when:** debugging, or when a fix is about to add a guard.

- **Reproduce first,** on the surface where the bug was reported. If it won't reproduce, tighten the conditions or instrument until it does.
- **Ask why until you reach the cause.** Instrument instead of guessing: add logging, read the real error, watch the value change.
- **No silencing guards.** A nil check that stops a crash is a symptom fix. A workaround that needs a paragraph of comment to justify it means the code is wrong.
- **Fix the pattern, not the instance.** Grep for the same shape and fix every occurrence.
- **"X used to work":** diff your own recent changes first and revert before engineering around it.
- **"Fails after restart":** suspect persisted state (config, caches, lock files, serialized data) before code.
- **Many symptoms:** look for one cause behind all of them before theorizing case by case.

When two fixes on the same premise have failed, stop and [attack the premise](attack-the-premise.md).

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-fix-root-causes` (MIT, Copyright (c) 2026 Lauren Tan).
