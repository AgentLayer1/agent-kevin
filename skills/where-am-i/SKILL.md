---
name: where-am-i
description: Show the Claude Code sessions from the last 24 hours scoped to the folder Kevin runs from (the HOME and everything beneath it), with a substantive summary of what each was about, where it left off, and the resume command. Use whenever the operator asks "where am I", "what sessions are running", "what was I working on", "which sessions are open", "I'm lost / overwhelmed", "what did I leave off on", or wants to find/resume a recent session. Also useful at the start of a day or after a break to re-orient. Accepts an optional hours window (e.g. "/agent-kevin:where-am-i 48") and "all" to include every project on the machine. Also runs in triage mode — `/agent-kevin:where-am-i triage [scope]` or when the operator asks "what should I tend to / work on next / which session needs me" — ranking the sessions by urgency and importance, interviewing via AskUserQuestion, and handing back the resume command for the chosen one.
allowed-tools: Bash, Read, AskUserQuestion, mcp__plugin_agent-kevin_kevin__report_write
---

# where-am-i — session radar

Re-orient the operator across their simultaneous Claude Code sessions. The deterministic
work (scanning `~/.claude/projects/`) lives in a bundled script; your job is the
synthesis: a per-session narrative good enough that the operator knows in one read
which thread is which and where it stands.

## Step 1 — gather

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/list_sessions.ts" --hours 24
```

- Default window is 24 hours; if the user gave a number (e.g. `/agent-kevin:where-am-i 48`),
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

Lead with a one-line **through-line** (a `>` blockquote): the single sentence that ties
today's sessions together. Then the buckets. No dated `# Where Am I` header — the
through-line carries the open, and surfaces (chat, dashboard) stamp the time themselves.

```
> The day was all Kevin tooling: a radar feature end-to-end, then a security pass and a docs sweep.

## 🟢 In motion (last hour)

**1. Weekly goals interview redesign** · *7m ago*

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
*6 sessions · 24h window · scoped to ~/Documents/Agents/Kevin*
```

Formatting rules:

- **Through-line first.** One `>` blockquote sentence synthesising the set, above the
  first bucket. It's what the operator reads if they read nothing else.
- **Card = `**N. Title** · *time ago*` on one line, then a blank line, then the summary
  paragraph, then a blank line, then the resume line.** The blank lines matter — they
  render as separate blocks (title, summary, resume) instead of one run-on paragraph.
  Nothing else — no directory, no branch, no turn counts, no truncated session id (the
  full id is already in the resume command). Mention a branch or sub-project inside the
  summary prose only when it's load-bearing for telling sessions apart.
- **Buckets:** 🟢 `minutes_ago <= 60` = "In motion", 🕐 otherwise = "Earlier today".
  If the window was widened past 24h, add a 📦 "Older" bucket per extra day.
- **Recognize yourself.** One session is the current conversation (its snippets describe
  what's happening right now). Tag its title `← this session`, skip its summary and
  resume line.
- **Resume line:** just `claude --resume <full-session-id>` — no `cd` prefix.
- **Order within buckets:** most recent first (the JSON is already sorted).
- **Footer:** total count, window, and scope (e.g. `scoped to ~/Documents/Agents/Kevin`
  or `all projects`).
- This is read-only with respect to sessions. Never resume, kill, or modify a session
  yourself.

## Step 4 — persist the digest

The radar is good history: a dated record of which threads were live and where each
stood. After rendering, save it via the
`mcp__plugin_agent-kevin_kevin__report_write` MCP tool — the helper writes the file
and inserts a one-line entry into `<HOME>/reports/index.md` under today's date, and the
SessionStart hook surfaces that entry in the next session's context.

```
report_write({
  category: 'radar',
  slug: 'where-am-i',
  title: <e.g. 'Where am I — 6 sessions across 24h'>,
  skill: 'where-am-i',
  body: <the full digest, no frontmatter — exactly what was shown in chat>,
  status: <'findings' if any session left work open, else 'clean'>
});
```

Surface `📄 Saved to <path>` (the absolute `path` the tool returns, not `relPath` — so it's command-clickable in any terminal) at the end of the digest. Skip the report only when the
scan returns zero sessions (nothing worth recording).

## Triage mode — `/where-am-i triage [scope]`

When the arguments contain `triage` (any case), or the operator asks "what should I tend
to / work on next / which session needs me", the question changes from *where am I* to
*where should I go*. Steps 1–2 run as normal; steps 3–4 are replaced by a ranked
interview. Everything comes from the session JSON already gathered — no other data
source. Triage is ephemeral — **no report**.

**Scope filter.** A remaining argument (e.g. `/where-am-i triage walapay`) keeps only
sessions whose `cwd` contains it, case-insensitively. No matches → say so and triage
the full set rather than returning empty-handed.

**Rank.** Order candidates by what most needs the operator, blending:

1. **Decision-pending** — `last_assistant_text` ends by asking the operator something
   ("Want me to…?", numbered options, an explicit question). The agent is stalled on a
   human call; oldest first.
2. **Importance** — weigh against the memory already in context: hard deadlines, P0/P1
   tasks, day-job precedence. A session tied to a dated obligation outranks a code
   review that can wait.
3. **Momentum** — a session that just finished (agent reported done) needs a look
   before its context goes cold; long-idle exploratory threads rank last.

Batch duplicates: several sessions on one work-stream (same branch or topic) are ONE
candidate — name the lead session and note the others in its description.

**Interview.** Present the top 3–4 via AskUserQuestion: label = short session name,
description = *why now* (one sentence: what it's waiting on, any deadline) + *what
tending means* (answer its question / review and approve / kick a stall / close it out).

**Deliver.** On selection, give the `claude --resume <full-session-id>` command and a
one-line brief of what to do on arrival (the specific question to answer or thing to
review). Never send input to the chosen session yourself — triage delivers the operator
to the work, it doesn't do the work.
