# Separate before serializing

**Apply when:** concurrent actors (processes, sessions, subagents, CI jobs, parallel worktrees) might write the same file, branch, key, or object.

First ask whether they need the same mutable object at all. Usually they are publishing independent facts.

- **Default: remove the shared write target.** Give each actor its own file, key, branch, worktree, or state directory, and merge at the read or reporting boundary. Two workers writing their own field into one `state.json` is still shared mutation. Two files are not.
- The same rule gives scratch files a `mktemp` name, each parallel agent its own worktree, and each attempt its own branch.
- **Serialize structurally only when one shared writer is a real invariant:** a lock file, sequential phases, a single-writer actor, or compare-and-swap. Instructions and conventions are not concurrency control.

Treat "we need a lock" as a design smell to check, not as the default answer.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-separate-before-serializing-shared-state` (MIT, Copyright (c) 2026 Lauren Tan).
