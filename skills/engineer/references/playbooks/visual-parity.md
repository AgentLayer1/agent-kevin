# Visual parity

**You own pixel-exact equivalence.** The baseline is the spec, and you don't touch it. Equivalence is proven by image diff, not by eye.

1. **Baseline first,** before any migration: screenshot the current component or page across its states (`browser_screenshot` for web, the Xcode loop's device screenshots for Apple apps), plus the target when matching two implementations. No baseline, no parity claim.
2. **Hold the anti-shortcut rules:** no harness changes, no baseline edits, no restructuring a component to make a diff pass. If the baseline looks wrong, stop and ask.
3. **One component at a time.** Shared primitives migrate first as a blocking phase; independent components can run in parallel worktrees, one owner each.
4. **Diff each component against its baseline** on the matching surface. A nonzero diff is a failure: investigate the pixel delta and iterate until it is zero.
5. Run the [comment pass](../comment-pass.md) and [handoff](../handoff.md) per component or per safe batch.

**Reply:** the components migrated, each one's diff result, where the baseline harness lives, and what's left.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) visual-parity playbook (MIT, Copyright (c) 2026 Lauren Tan).
