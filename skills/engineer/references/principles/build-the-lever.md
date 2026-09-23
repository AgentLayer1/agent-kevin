# Build the lever

**Apply when:** the work is non-trivial: edits across many files, migrations, analyses, repeated checks.

Build the tool that does the work or proves it (a codemod, script, generator, or query) instead of doing it by hand. It pays twice. It does the job the same way every time, and a reviewer can read it and rerun it. "Trust me" becomes "run this".

- Do the first unit by hand to learn the recipe, then build the tool. Prove it by rerunning it on that unit and diffing against your hand version. Make it safe to rerun.
- A deterministic script beats fanning out subagents to hand-apply the same edit.
- When you do fan out, write the recipe, the verification contract, and the do-not-touch fences into one file every worker reads, outside their write scope.
- Build the smallest script that does or proves the job, never a framework ([subtract first](subtract-first.md)). A scratch lever gets a `mktemp` path. Commit it when the work outlives the session.

The bar is triviality, not repetition. A one-off still earns a lever when the lever is what makes it checkable. If you cite this principle and no script appears in the diff or the transcript, you didn't apply it.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-build-the-lever` (MIT, Copyright (c) 2026 Lauren Tan).
