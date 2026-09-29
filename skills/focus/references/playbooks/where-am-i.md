# Where am I — the session radar (`/focus where-am-i [hours | all]`)

Re-orient the operator across their simultaneous Claude Code sessions. The deterministic
work (scanning `~/.claude/projects/`) lives in a bundled script; your job is the
synthesis: a per-session narrative good enough that the operator knows in one read
which thread is which and where it stands.

Three playbooks cover session continuity:

| Playbook | Subject | Output |
|---|---|---|
| where-am-i | every session in scope | digest + saved report |
| [triage](triage.md) | every session in scope | ranked interview, ephemeral |
| [checkpoint](checkpoint.md) | **this session only** | a pickup note as chat, captured on exit |

The dashboard and sync skills run this playbook to freshen the radar the dashboard reads.

## Step 1 — gather

```bash
bun "${CLAUDE_SKILL_DIR}/scripts/list_sessions.ts" --hours 24
```

- Default window is 24 hours; if the user gave a number (e.g. `/agent-kevin:focus where-am-i 48`),
  pass it as `--hours`.
- **Scope:** the script derives the default roots itself — the launch cwd, the agent HOME
  (`${KEVIN_HOME:-$AGENT_HOME}`), and the code tree (the parent of `${KEVIN_CODE_PATH:-$AGENT_CODE_PATH}` — repos and their
  sibling worktrees) — so the radar sees HOME sessions and code-repo sessions even though
  they live in separate trees. `--scope` overrides with comma-separated roots; a session
  counts when launched in any root or beneath it. Duplicate roots are fine (the script
  dedupes); other agents' homes stay out of scope. If the user says "all" / "everywhere" /
  asks about other projects, pass `--scope all`.
- Output is JSON, newest first. Each session has: `session_id`, `title` (the operator's
  `/rename` name when set, else Claude Code's first-prompt auto-title), `cwd`,
  `git_branch`, `first_user_msg`, `recent_user_msgs` (last 3),
  `last_assistant_text` (long excerpt of the final reply), `minutes_ago`, `file`.
- **`minutes_ago` and the sort come from the transcript's last record, not file mtime** — a
  bulk touch (a `git checkout`, a backfill) moves mtime forward and would rank a stale session
  as live. So the ordering is trustworthy; don't second-guess it against file timestamps.

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
today's sessions together. Then a compact **index table** — the scan layer: one row per
session, state emoji first. Then the buckets carry the substance. No dated `# Where Am I`
header — the through-line carries the open, and surfaces stamp the time themselves.

```
> The day was all Kevin tooling: a radar feature end-to-end, then a security pass and a docs sweep.

|   | # | Session | Last |
|---|---|---------|------|
| ❓ | 1 | Weekly goals interview redesign | *7m* · asked which scope to grill on |
| ✅ | 2 | Session capture cursor fix | *3h* · shipped, tests green |
| 🚧 | 3 | Blog draft exploration | *9h* · mid-draft, parked |

## 🟢 In motion (last hour)

**1. Weekly goals interview redesign** · *7m ago*

Started from the ask to make the weekly and monthly goals skills consider the full task
board and recent sessions, then interview you instead of generating generic goals. The
session widened both skills' inputs to pull every task across all statuses and priorities
and added the grilling-interview behavior, all in the plugin source. The last reply
reported both skills upgraded, so this is at a clean stopping point unless you want to
test-drive the new flow.

↳ `claude --resume 0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d`

## 🕐 Earlier today

...same card shape...

---
*6 sessions · 24h window · scoped to ~/Documents/Agents/Kevin*
```

Formatting rules:

- **Through-line first.** One `>` blockquote sentence synthesising the set, above the
  first bucket. It's what the operator reads if they read nothing else.
- **Index table second** — one row per session, same order and numbering as the cards.
  Columns: state emoji (❓ the last reply asks the operator something · ✅ clean stop,
  work delivered · 🚧 mid-flight or stalled without a question), number, title, then
  `*age*` + a ≤6-word fragment of where it left off. Keep cells short — the substance
  lives in the cards, the table is the map. Skip the table when there are ≤2 sessions.
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
  skill: 'focus',
  body: <the full digest, no frontmatter — exactly what was shown in chat>,
  status: <'findings' if any session left work open, else 'clean'>
});
```

Surface `📄 Saved to <path>` (the absolute `path` the tool returns, not `relPath` — so it's command-clickable in any terminal) at the end of the digest. Skip the report only when the
scan returns zero sessions (nothing worth recording).
