# Blast radius

**You own what a change could break somewhere else,** before it ships. Use it for a small diff you don't trust yet, or "what could this break". [How](how.md) says what code does and [why](why.md) says why it's shaped that way; this says what it breaks elsewhere. Listing callers isn't the job, since grep does that in a second. The job is the breakage grep won't show you.

A writeup that sounds right is worthless: it reads as convincing whether or not it's true. Find the one or two facts the change's safety depends on, and prove them by running code.

1. **Read the change:** the diff, the symbols it adds, changes, and deletes, and what it now does differently, including the part the diff doesn't spell out.
2. **Find the one fact it's safe because of.** Most risky-looking changes are safe because of a single fact ("this call only drops cache entries that are already dead"). If it holds, most risky cases clear at once. Spend your time here.
3. **Look where grep stops:** the library's own source at its pinned version and any local patch; when things run (microtasks, teardown, render phases); the JSON an API returns, a database column, a wire format, another language reading the same bytes, a feature flag, code three hops downstream.
4. **Rate each risk honestly:** a real chance of happening and a real cost if it does. Keep the confirmed ones, list the checked-and-cleared ones separately, cite a real `file:line`, and never invent a caller or an API.
5. **Prove the one fact** as far down the [proof ladder](../principles/prove-it-works.md) as is cheap. Usually that's one small script that imports the library the app ships and calls the exact function you're worried about. Paste what happened.
6. For a big or wide change, run it as an [arena](../arena.md) or get a second model on it with the adversarial-review skill.

**Reply:**

- **What it does**, including the part that isn't obvious.
- **The one safety fact**, the ladder level it reached, and the proof (or "unproven").
- **The risks**: how each breaks, `file:line`, likelihood and cost, and how to check.
- **What was cleared, and why.**
- **The cheapest check to run before merging**, including the script you wrote.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `blast-radius` skill (MIT, Copyright (c) 2026 Lauren Tan).
