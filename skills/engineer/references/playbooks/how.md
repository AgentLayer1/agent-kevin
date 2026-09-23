# How it works

**You own an explanation a senior engineer could onboard from:** enough to build a working mental model, not annotated source. Use it for "how does X work", before changing unfamiliar code, and for placement questions ("where should this live", "which package owns this", "is this the right layer"). For motivation, use [why](why.md).

1. **Size the question.** A single module or a narrow question gets one pass: explore and explain yourself. A subsystem spanning files or services gets two to four read-only explorer subagents first, each on a distinct slice. When in doubt, take the simple path.
2. **Brief each explorer** with the question, its slice, and this method: find the entry point (what triggers the behavior); trace the flow through each function and the data between them; map the key types and services; find the boundaries (what goes in, what comes out); note anything surprising or historical. Don't guess from names; read the code. Each returns components found (name, path, one line), the flow step by step, files read, boundaries, non-obvious things, and open questions.
3. **Synthesize** the explorers' findings into one account, reconciling overlaps and checking any contradiction against the code yourself.
4. **Write it** in these sections, dropping any that don't apply:
   - **Overview:** one or two paragraphs on what it is, what it does, and why it exists.
   - **Key concepts:** the types and services needed to follow the rest.
   - **How it works:** the flow, what triggers it, where data goes, the decision points. Prose with `file` and function names, not pseudocode. A diagram when components talk to each other (ASCII in chat, Mermaid in files), built up one part at a time when there are three or more moving parts.
   - **Where things live:** a short file map for someone starting work here.
   - **Gotchas:** surprising behavior, historical context, pitfalls.

Concrete language: "`UserService` calls `AuthClient.refresh()`", not "the service delegates to the client". When something is complex, say why. When it's simple, don't pad it. Name the gaps the explorers couldn't trace.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `how` and `teach` skills (MIT, Copyright (c) 2026 Lauren Tan).
