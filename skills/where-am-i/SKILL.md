---
name: where-am-i
description: Show the Claude Code sessions from the last 12 hours scoped to the folder Kevin runs from (the HOME and everything beneath it), with a substantive summary of what each was about, where it left off, and the resume command. Use whenever the operator asks "where am I", "what sessions are running", "what was I working on", "which sessions are open", "I'm lost / overwhelmed", "what did I leave off on", or wants to find/resume a recent session. Also useful at the start of a day or after a break to re-orient. Accepts an optional hours window (e.g. "/agent-kevin:where-am-i 24") and "all" to include every project on the machine.
disable-model-invocation: true
allowed-tools: Bash, Read
---

# where-am-i — session radar

Re-orient the operator across their simultaneous Claude Code sessions. The deterministic
work (scanning `~/.claude/projects/`) lives in a bundled script; your job is the
synthesis: a per-session narrative good enough that the operator knows in one read
which thread is which and where it stands.

## Step 1 — gather

```bash
python3 "$CLAUDE_PLUGIN_ROOT/skills/where-am-i/scripts/list_sessions.py" --hours 12
```

- Default window is 12 hours; if the user gave a number (e.g. `/agent-kevin:where-am-i 24`),
  pass it as `--hours`.
- **Scope:** by default only sessions launched in the current folder or beneath it are
  included (running from Kevin's HOME picks up the HOME and any sub-project under it —
  but not other agents' homes). If the user says "all" / "everywhere" / asks about other
  projects, pass `--scope all`.
- Output is JSON, newest first. Each session has: `session_id`, `title` (Claude Code's
  auto-title), `cwd`, `git_branch`, `first_user_msg`, `recent_user_msgs` (last 3),
  `last_assistant_text` (long excerpt of the final reply), `minutes_ago`, `file`.

## Step 2 — write the summaries

The summary is the whole point of this skill, and it must be substantive — a short
paragraph (roughly 3–5 sentences), not a fragment. A one-liner forces the operator to
resume the session just to find out what it was; that defeats the purpose. Cover:

1. **What the session is about** — the original ask (`first_user_msg`), in plain words.
2. **What happened** — the key findings or work done along the way.
3. **Where it stands now** — the last exchange (`recent_user_msgs` + `last_assistant_text`):
   was something shipped, was a conclusion reached, is there an unanswered question?
4. **What's open** — the natural next step if the operator resumes, when one exists.

If the JSON snippets don't support that (thin snippets, image-only last messages),
read the transcript tail before writing — `tail -c 80000 <file>` and skim the last few
assistant messages. Don't guess and don't pad; a summary that "makes no sense" is worse
than reading another 80KB.

## Step 3 — render the digest

```
# 🧭 Where Am I — Thu Jun 11, 4:50 PM

## 🟢 In motion (last hour)

**1. Weekly goals interview redesign**
*7m ago*
Started from the ask to make the weekly and monthly goals skills consider the full task
board and recent sessions, then interview you instead of generating generic goals. The
session widened both skills' inputs to pull every task across all statuses and priorities
and added the grilling-interview behavior, all in the plugin source. The last reply
reported both skills upgraded, so this is at a clean stopping point unless you want to
test-drive the new flow.
↳ `claude --resume b7bf6ce8-79dd-429d-b9a7-a643a6dcda1e`

## 🕐 Earlier today

...same card shape...

---
*6 sessions · 12h window · scoped to ~/Documents/Agents/Kevin*
```

Formatting rules:

- **Card = bold title, then time-ago line, then the summary paragraph, then the resume
  line.** Nothing else — no directory, no branch, no turn counts, no truncated session
  id (the full id is already in the resume command). Mention a branch or sub-project
  inside the summary prose only when it's load-bearing for telling sessions apart.
- **Buckets:** 🟢 `minutes_ago <= 60` = "In motion", 🕐 otherwise = "Earlier today".
  If the window was widened past 24h, add a 📦 "Older" bucket per extra day.
- **Recognize yourself.** One session is the current conversation (its snippets describe
  what's happening right now). Tag its title `← this session`, skip its summary and
  resume line.
- **Resume line:** just `claude --resume <full-session-id>` — no `cd` prefix.
- **Order within buckets:** most recent first (the JSON is already sorted).
- **Footer:** total count, window, and scope (e.g. `scoped to ~/Documents/Agents/Kevin`
  or `all projects`).
- This is read-only. Never resume, kill, or modify a session yourself.
