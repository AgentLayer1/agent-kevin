# Fix root causes

**Apply when:** debugging, or when a fix is about to add a guard.

- **Reproduce first,** on the surface where the bug was reported. If it won't reproduce, tighten the conditions or instrument until it does.
- **Ask why until you reach the cause.** Instrument instead of guessing: add logging, read the real error, watch the value change.
- **No silencing guards.** A nil check that stops a crash is a symptom fix. A workaround that needs a paragraph of comment to justify it means the code is wrong.
- **Fix the pattern, not the instance.** Grep for the same shape and fix every occurrence.
- **"X used to work":** diff your own recent changes first and revert before engineering around it.
- **"Fails after restart":** suspect persisted state (config, caches, lock files, serialized data) before code.
- **Many symptoms:** look for one cause behind all of them before theorizing case by case.

## Attack the premise

When two or more fixes that share one premise have failed the same check, stop fixing.

1. Write the premise down in one sentence: the thing every failed fix assumed.
2. Before the next fix, take a census with a rerunnable script. Which actors, inputs, or runs hold the imbalance?
3. If the same few hold it every run, find what assigns them that role. That assignment is the next "why".
4. Remove the asymmetry instead of compensating for it. A retry, a shared pool, or a periodic rebalance leaves the cause in place and adds work on every run.

If the census comes out even, the premise isn't the cause. Look elsewhere, and keep the census as evidence.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-fix-root-causes` and `principle-attack-the-premise` (MIT, Copyright (c) 2026 Lauren Tan).
