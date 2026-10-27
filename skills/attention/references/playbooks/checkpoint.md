# Checkpoint — a checklist of where work stands (`/attention checkpoint [all [hours] [filter]]`)

`/attention checkpoint` maps **this** session. `/attention checkpoint all` maps every session in
scope, the default window being the last 24 hours (`/attention checkpoint all 48` widens it),
ranks what's waiting on the operator, and offers to jump to one. Both use the shape below,
and both run only when asked: nothing draws them between turns. The dashboard and sync
skills run checkpoint all to freshen the radar the dashboard reads.

## The shape

```
**<what the session is working on, as a short title>**

✓ <a finished step> (<its proof: tests green, seen on device, merged>)
✓ <a finished step nobody proved> (assumed)

▶ <what's in progress right now>
▷ next: <the concrete next action for someone picking this up cold>

★ **Waiting on you**
  1. <a decision only the operator can make> → <your pick, and why in a few words>

⚠ <a trap, a decision that constrains what's next, or a blocked dependency>

**Changed since the last checkpoint**
  <repo> <file or branch>  <what changed>  (<uncommitted | committed abc1234 | pushed>)
```

- **A step is a piece of the work** ("fixed the timeline cap"), never the conversation
  ("read the files", "explained X"). One line each, at most about seven ✓ lines; merge
  the oldest into one line as the list grows.
- **Every ✓ says how it was proven**, or `(assumed)`.
- **★ holds only decisions waiting on the operator**, each with your pick. ⚠ holds at
  most two lines. Drop any section with nothing in it, ▶ included when nothing is in
  progress.
- **A blank line between groups**, so the ▶ line and each section stand out.
- **Refer to things by task id, repo name, and branch — never absolute paths.** Paths go
  stale (layouts move, worktrees get pruned); a task id and a branch name don't.

## This session (`/attention checkpoint`)

The script never runs — you already have the context the script would be trying to
infer from a transcript.

**Scope: the current session only.** A transcript read from outside can only guess at
what was verified versus assumed; the live session knows. If the operator names another
session id, tell them to run the command inside it, or to run `checkpoint all`.

**Write it as your reply — never to a file.** The `SessionEnd` capture picks up assistant
turns, so a checkpoint written as chat lands in `knowledge/raw/sessions/` on exit and
compiles into knowledge from there. Writing a file instead is both redundant and often
impossible: sessions launched in a code repo can't write to the agent home (outside cwd),
and the plugin isn't loaded there at all.

- **The checklist covers the whole session** each time, so it reads cold. **Changed
  covers only what moved since the most recent checkpoint** in this conversation (none
  means everything this session changed). The previous checkpoint is in the context
  you're already reading, so no state file.
- **Changed comes from git**: run `git status -sb` in each repo the session touched, in
  the same turn.

**Task thread.** When the work maps to a task and the task tools are available, also
append the checkpoint to that task's thread via `task_thread` — that's the durable home
for task-linked work. Skip when the thread already says it: a checkpoint that restates
the last entry is noise in the one place that should stay signal.

**Availability.** Plugin skills only exist where the plugin is enabled — the agent home,
not code repos. In a repo session, paste the shape above as a prompt instead.

## All sessions (`/attention checkpoint all [hours] [filter]`)

### Step 1 — gather

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/list_sessions.ts" --hours 24
```

- Pass the operator's number as `--hours` when they gave one. A remaining word
  (`/attention checkpoint all acme`) keeps only sessions whose `cwd` or title contains it,
  case-insensitively; with no matches, say so and map the full set.
- **Scope:** by default the script covers this home and the code tree, never other
  agents' homes. `--scope <path>,<path>` overrides; pass `--scope all` when the operator
  says "everywhere" or asks about other projects.
- Output is a JSON object: `generated_at`, `scope`, `window_hours`, `count`, and
  `sessions`, newest first. Each session has: `session_id`, `title` (the operator's
  `/rename` name when set, else Claude Code's first-prompt auto-title), `cwd`,
  `git_branch`, `first_user_msg`, `recent_user_msgs` (last 3), `last_assistant_text`
  (long excerpt of the final reply), `last_checkpoint` (the newest checklist the session
  wrote, or `null`), `turns_since_checkpoint`, `minutes_ago`, `file`. `minutes_ago` and the
  order come from each transcript's last record, not file mtime, so trust them.

### Step 2 — map each session

Write each session in the shape, from what its transcript shows:

1. **A session with a `last_checkpoint`** starts from it, as written. When
   `turns_since_checkpoint` is above zero, fold in what came after it
   (`recent_user_msgs` + `last_assistant_text`): new ✓ steps, a new ▶, a new ★.
2. **A session without one** is mapped from `first_user_msg` (the ask), the snippets,
   and `last_assistant_text` (where it stands). A last reply that asks the operator
   something is a ★, with the pick it recommended.
3. **When the snippets are too thin** (image-only messages, a bare last reply), read the
   transcript tail before writing — `tail -c 80000 <file>` — rather than guess. A ✓ gets
   its proof only when the transcript shows it; otherwise `(assumed)`.

At most four ✓ lines per session, and no Changed section: another session's repo state
isn't this session's to report.

### Step 3 — render

```
★ **Waiting on you**
  1. <session title>: <question> → <the pick>

## 🟢 In motion (last hour)

**1. <title>** · *7m ago*

✓ …

▶ …
▷ next: …

↳ `claude --resume <full-session-id>`

## 🕐 Earlier today

…same card shape…

---
*6 sessions · 24h window · scoped to ~/Documents/Agents/Kevin*
```

- **★ Waiting on you leads**, collecting every session's pending decisions, numbered,
  each naming its session. Rank them by importance first (a dated obligation, a P0/P1
  task, day-job precedence, weighed against the memory already in context), then by how
  long they've waited. Several sessions on one work stream (same branch or topic) share
  one entry that names the lead session. With none pending, lead with one `>` sentence
  that ties the sessions together instead.
- **Many waiting** (more than about five ★ entries) or an operator who sounds
  overwhelmed: close the report with one line pointing at `/attention plan` to cut today to
  three.
- **Card = `**N. Title** · *time ago*`, a blank line, the session's checklist, a blank
  line, the resume line.** The dashboard parses exactly that frame, so keep it. Nothing
  else on the card (no directory, branch or turn count, and no ★: decisions are listed
  once, in the lead list); mention a branch inside a step only when it tells two sessions
  apart.
- **Buckets:** 🟢 `minutes_ago <= 60` = "In motion", 🕐 otherwise = "Earlier today".
  A widened window adds a 📦 "Older" bucket per extra day. Most recent first within each.
- **This session** gets a card too, its title tagged `← this session`, written from what
  you know rather than its transcript, and with no resume line.
- **Resume line:** just `claude --resume <full-session-id>`, no `cd` prefix.
- **Footer:** total count, window, and scope.

### Step 4 — save

Save the rendered output as the radar report with
`mcp__plugin_agent-kevin_kevin__report_write`, which writes the file and adds a line to
`<HOME>/reports/index.md` that the next session's start surfaces:

```
report_write({
  category: 'radar',
  slug: 'checkpoints',
  title: <e.g. 'Checkpoints — 6 sessions across 24h'>,
  skill: 'attention',
  body: <exactly what was shown in chat, no frontmatter>,
  status: <'findings' if any session has a ★ or work left open, else 'clean'>
});
```

End with `📄 Saved to <path>` (the absolute `path` the tool returns, so it's clickable).
Skip the report only when the scan found no sessions.

### Step 5 — offer a jump

Only when the operator asked for checkpoint all themselves and ★ has entries; when sync
or the dashboard runs it, stop after saving. Offer the top three or four ★ entries in
one `AskUserQuestion` ("Jump to one?"): label = the short session name, description =
what it's waiting on and any deadline. On a pick, give its `claude --resume
<full-session-id>` and one line on what to do on arrival (the question to answer, the
thing to review). Never send input to the session yourself: this delivers the operator
to the work, it doesn't do the work.
