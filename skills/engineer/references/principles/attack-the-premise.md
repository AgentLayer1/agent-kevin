# Attack the premise

**Apply when:** two or more fixes that share one premise have failed the same check.

Each failure under a shared premise is evidence about the premise. Stop fixing and question it.

1. **Write the premise down** in one sentence: the thing every failed fix assumed.
2. **Take a census before the next fix,** as a rerunnable script ([build the lever](build-the-lever.md)). Which actors, inputs, or runs hold the imbalance? The census shows who holds it, not how large it is.
3. **Read the skew.** If the same few hold it on every run, something assigns them that role. Find what assigns it: that is the next "why" ([fix root causes](fix-root-causes.md)).
4. **Remove the asymmetry instead of compensating for it** ([laziness protocol](laziness-protocol.md)). Rotate or move the role so no actor holds it every time. A retry, a shared pool, a batched hand-off, or a periodic rebalance leaves the assignment in place and adds work on every run.

**Stop:**

- Don't start the next fix before the premise is written down and the census exists.
- If the census comes out even, the premise isn't the cause. Look elsewhere, and keep the census as evidence.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-attack-the-premise` (MIT, Copyright (c) 2026 Lauren Tan).
