# Worktree cleanup

**You own the disk and the safety gate.** Prune merged or abandoned worktrees (and, on macOS, stale simulators) to reclaim space. Deletion is irreversible, so every step guards against removing something in use or holding uncommitted work.

1. **Snapshot and audit.** Record `df -h /`, then run the read-only `list_worktrees` triage (the setup-worktree skill's audit). It reads paths from `git worktree list` rather than guessing them, and classifies each by merge state, uncommitted work, and age.
2. **A verdict is advice, not permission.** Check every candidate against the sessions still using it (where-am-i, find-session). An active session's worktree is in use even when its name looks stale.
3. **Pause on irreversible loss.** Uncommitted tracked edits mean show the diff and get the operator's decision; a clean worktree is recoverable from its branch, uncommitted work is not. Untracked scratch is safe to drop, but name the files.
4. **Prune the confirmed set** with `remove_worktree` per path, then `git worktree prune`. Branch refs survive, so no commits are lost. Confirm with `df -h /` and a fresh listing.
5. **Other reclaimers,** only with the operator's go: simulator clones and unavailable devices (`xcrun simctl delete unavailable`), old simulator runtimes, Xcode DerivedData, package-manager caches. Never clear a cache the operator said to keep.

**Reply:** `df -h /` before and after, the worktrees pruned, and a one-line reason for each one held back.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) worktree-cleanup playbook (MIT, Copyright (c) 2026 Lauren Tan).
