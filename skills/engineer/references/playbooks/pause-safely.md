# Pause safely

**You own a clean stop** that a cold-start session can resume from. Only on an explicit pause, going offline, or imminent compaction. "Keep going" or "don't stop" means don't pause.

1. **Stop at a safe boundary.** Finish the current atomic step or back out of it. Start nothing new, and stop any subagents you launched.
2. **Take no irreversible action to pause.** No push, no PR, no tag.
3. **Leave the work durable without new commits.** Uncommitted edits stay in the working tree (commits happen only within the scope the operator approved). If the tree is broken, say so plainly in the note.
4. **Write the resume note** with the where-am-i skill's checkpoint mode, so the session capture files it: the intent, what you were doing, progress and what's verified, current state, next steps, key files, and gotchas. If a [decision log](../decision-log.md) exists, point at it instead of repeating it.

**Reply:** where you are in the loop, what's on disk versus still in your head (paths, not diffs), whether the tree is clean, and the first action on resume. This is a pause, not a final report.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) pause-safely playbook (MIT, Copyright (c) 2026 Lauren Tan).
