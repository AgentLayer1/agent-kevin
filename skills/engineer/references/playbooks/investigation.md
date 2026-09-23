# Investigation

**You own the answer.** The work is read-only. The deliverable is a cited explanation or a recommendation, not a code change.

1. Anchor in code: the files, symbols, and line ranges in scope. When the question spans a subsystem, fan out read-only subagents, one per slice, and keep only their conclusions ([guard the context window](../principles/guard-the-context-window.md)).
2. For "why is it like this", read the history: `git log --follow -p -- <file>`, `git blame -L <start>,<end> <file>`, the PR bodies behind the commits, and any task or session notes in the home that touched the area.
3. Label every claim by how you know it:
   - **Direct:** someone wrote it down. Cite the source.
   - **Supported:** several sources converge. Cite them.
   - **Inferred:** your reading of the context. Hedge it and show the chain.
   - **Unknown:** say exactly what you searched and what came back empty.

   The code is not evidence of its own intent. A hypothesis embedded in the question is one candidate, not a conclusion to confirm.
4. Write the answer as an overview, the key concepts, how it works (data from input to output), where things live (`file:line`), and the gotchas. For a choice between options, give the verdict first, then a tradeoffs table.

**Reply:** the answer in the first sentence, then the structure above. Push back if the premise is wrong. If the investigation precedes a change, name the playbook that takes over.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) investigation playbook and the `how` and `why` skills (MIT, Copyright (c) 2026 Lauren Tan).
