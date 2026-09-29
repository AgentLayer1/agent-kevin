# Checkpoint — a pickup note for this session (`/focus checkpoint`)

When the operator runs `/focus checkpoint`, or asks to "checkpoint this session / save
where we are / write a handoff", the subject flips from *other* sessions to **this** one. The script never runs — you already have the context the
script would be trying to infer from a transcript.

**Scope: the current session only.** Never checkpoint another session. A transcript read
from outside can only guess at what was verified versus assumed; the live session knows.
If the operator names another session id, tell them to run the command inside it.

**Incremental by construction.** Look back through this conversation for the most recent
checkpoint you wrote. Cover only what happened *since* it — earlier ground is already
recorded and re-summarising it buries the new material. No prior checkpoint means cover
the whole session. This needs no state file: the previous checkpoint is in the context
you're already reading.

**Write it as your reply — never to a file.** The `SessionEnd` capture picks up assistant
turns, so a checkpoint written as chat lands in `knowledge/raw/sessions/` on exit and
compiles into knowledge from there. Writing a file instead is both redundant and often
impossible: sessions launched in a code repo can't write to the agent home (outside cwd),
and the plugin isn't loaded there at all.

**Shape** — under ~10 lines, no preamble:

- **Thread** — what this session is working on, one sentence
- **State** — what's done; committed/pushed vs uncommitted; **verified vs assumed**
- **Next** — the concrete next action for someone picking this up cold
- **Watch** — what would bite them: a decision made, a trap found, a blocked dependency

**Refer to things by task id, repo name, and branch — never absolute paths.** Paths go
stale (layouts move, worktrees get pruned); a task id and a branch name don't.

**Task thread.** When the work maps to a task and the task tools are available, also
append the checkpoint to that task's thread via `task_thread` — that's the durable home
for task-linked work. Skip when the thread already says it: a checkpoint that restates
the last entry is noise in the one place that should stay signal.

**Availability.** Plugin skills only exist where the plugin is enabled — the agent home,
not code repos. In a repo session, paste the four bullets above as a prompt instead.
