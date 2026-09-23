# Prove it works

**Apply when:** finishing a task, before saying done, and whenever a claim rests on something you didn't observe.

Verify against the real artifact, not a proxy, a self-report, or "it compiles".

- **Build it** (necessary, not sufficient), **run it**, and exercise the actual feature path. Check the full chain from input to output. For an integration, drive the whole communication path.
- **Read the actual value,** not a cached or derived one. Check liveness directly, not through mtimes or state files.
- **When verification fails, suspect the observation before the system.**
- **Delegated work** is checked from its diff, its files, and its running behavior. Never pass a subagent's summary through as proof.
- **Verify on the surface the operator uses:** the simulator or device through the Xcode loop, the page through the browser tools, the CLI in a real terminal. A wrong-surface or inconclusive result is not a pass. Say so.

## How sure are you

Take each load-bearing fact as far down this ladder as is cheap, and report where it stopped.

1. You said so. Worth nothing on its own.
2. You pointed at the line: a real `file:line`, or the library's own source.
3. You walked the failure step by step and showed it can't be reached.
4. You ran it: a script or test calls the real code and fails loudly if you're wrong.
5. You reproduced it in the running app.

Most risky-looking changes are safe because of one fact, like "this call only drops cache entries that are already dead". Find that fact and prove it at level 4 or 5. Spend the time there, not on a long list of maybes.

Script the check when you can, and keep its output where the operator can see it. A rerunnable check beats a one-time look.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-prove-it-works` and the `blast-radius` skill (MIT, Copyright (c) 2026 Lauren Tan).
