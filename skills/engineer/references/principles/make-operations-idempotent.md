# Make operations idempotent

**Apply when:** designing commands, lifecycle steps, migrations, syncs, or loops that run amid crashes, restarts, and retries.

Every state-changing operation answers two questions: what happens if it runs twice, and what happens if the last run crashed halfway? If the answer is "it depends on what was left behind", it needs a reconciliation step.

- **Converge on start.** Scan existing state, clean stale artifacts, and adopt live sessions instead of assuming a clean slate.
- **Compare by content,** not by creation order or timestamps.
- **Self-heal locks.** Detect a stale lock by PID or lease, never by the lock file merely existing.
- **Write, verify, then stamp.** Record the "done" marker (a version, a cursor) last, so a partial run stays re-runnable.
- **Respawn failed work cleanly,** and regenerate fresh input on each cycle.
- **Nothing sticks forever.** Any pause, block, or lock proves it can't wedge: validate its shape on load, cap it with a hard ceiling, and make it visible at startup.

**The test:** run it twice in a row, then kill it at each step and rerun. Does it converge to the same end state every time?

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-make-operations-idempotent` (MIT, Copyright (c) 2026 Lauren Tan).
