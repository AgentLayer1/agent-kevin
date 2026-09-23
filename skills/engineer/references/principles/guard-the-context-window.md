# Guard the context window

**Apply when:** context is filling up: big outputs, long files, repeated reads, fan-out planning.

The context window is finite and doesn't renew within a session. Every token should earn its place.

- **Route bulk to subagents:** wide searches, long logs, transcripts, screenshots. The main thread gets their conclusions and file pointers, not the raw payload.
- **Read the slice that answers the question,** and skip what you won't use. But never conclude from a partial read. Page through or grep the rest first.
- **Brief a subagent** with file pointers and the success criterion, not pasted context.
- **Size phases and cap scope:** a limit on files per phase, a budget of turns.
- **In a skill,** keep what every run needs inline and move what only one branch needs into a reference file.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `principle-guard-the-context-window` (MIT, Copyright (c) 2026 Lauren Tan).
