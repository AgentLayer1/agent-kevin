---
name: find-session
description: Find a specific past Claude Code session by what it worked on — a branch, a PR number, a worktree, a bug, a feature, a task id — and hand back its resume command. Content search over all transcript history, not a time-boxed list. Use when the operator asks "find the session that…", "which session was working on/with X", "give me the session that did X", "what session was I fixing X in", "search my sessions for X", or "resume the session about X". Complements where-am-i (the recent-sessions radar) — reach for this when the operator names WHAT the session did rather than WHEN it ran.
allowed-tools: Bash, Read, AskUserQuestion
---

# find-session — locate a session by its content

The operator remembers the work, not the session id. This skill turns "the session that
was reworking the dashboard radar" into `claude --resume <id>`. The deterministic
work (grep + signal extraction across `~/.claude/projects/`) lives in a bundled script;
your job is the discrimination: separating the session that *did* the work from the
briefings, syncs, and standups that merely *mentioned* it.

## Step 1 — derive search terms

Pull the most distinctive tokens from the ask. In rough order of power:

- **Branch / worktree slugs** (`basem/radar-recency`, `dark-mode`) — near-unique.
- **PR numbers** — search both spellings in one run: `#490` and `pull/490`.
- **Stable identifiers** — task ids (`ac-012`), error strings, ticket numbers.
- **Feature phrases** — a short distinctive phrase (`badge overflow`), not single
  common words (`dashboard` alone matches half the corpus).

Pass several variants in one invocation — terms OR together, and per-term counts come back
separately. If the operator's phrasing is vague, translate it into the artifact vocabulary
first (the branch, the PR, the file) using the memory already in context.

## Step 2 — run the search

```bash
SCOPE="$PWD"
[ -n "$KEVIN_HOME" ] && SCOPE="$SCOPE,$KEVIN_HOME"
[ -n "${KEVIN_CODE_PATH:-$AGENT_CODE_PATH}" ] && SCOPE="$SCOPE,$(dirname "${KEVIN_CODE_PATH:-$AGENT_CODE_PATH}")"
bun "${CLAUDE_SKILL_DIR}/scripts/find_session.ts" --scope "$SCOPE" "<term>" "<term2>" ...
```

- **No time window by default** — the whole transcript history is searched. Add
  `--hours <n>` only when the operator anchors it in time ("last week's session").
- Scope semantics match where-am-i: comma-separated roots, sessions launched in or beneath
  any of them. Zero matches → retry with `--scope all` before declaring it not found.
- Output is JSON sorted by raw hit count — **that sort is a starting point, not the
  answer** (Step 3). Each match carries: `title` (operator's `/rename` wins over the
  auto-title), `started` / `last_timestamp`, `cwds` (every directory the session roamed
  into), `git_branches`, `first_user_msg`, `slash_commands`, `hits` per term,
  `terms_in_user_prompts` (which terms appear in the operator's own messages).

## Step 3 — rank by signal, not by hit count

Briefings, syncs, standups, and radar runs mention *everything* — they routinely out-hit
the session that did the work. Weigh, first match wins ties:

1. **Term in the operator's own prompts** (`terms_in_user_prompts` non-empty) — they asked
   for this work by name. The strongest single signal.
2. **Title describes the work** — especially a custom title (a `/rename` was deliberate).
3. **cwd roamed into a matching worktree** — a session whose `cwds` include
   `<repo>-<slug>` did hands-on work there; nothing else produces that trail.
4. **Hit concentration** — many hits in a session *not* explained by 1–3 usually means a
   reporting session. `slash_commands` names them (`/sync`, `/standup`, a briefing); a
   high-hit session that is just a skill run is a mention, not the work.

Traps, learned the hard way:

- **`git_branches` is the launch branch, not the work branch.** Sessions launch from the
  agent HOME on `main` and then roam; the branch the operator asked about shows up in
  worktree `cwds` and in content, almost never in `gitBranch`.
- **Commit SHAs and commit messages don't appear in transcripts** when the operator
  authors commits themselves — don't search for them.
- **File mtimes are unreliable** (bulk-touched by checkouts/backfills); the script's
  timestamps come from the transcript records, trust those.
- **One of the matches is this conversation** — the ask itself contains the terms.
  Recognize it and exclude it.

## Step 4 — verify, then deliver

Never hand back a resume command on ranking alone. For the top candidate, confirm against
`first_user_msg`, the timestamps, and the cwd trail that it actually is the work the
operator described; if that's not conclusive, read the transcript's tail
(`tail -c 80000 <file>`) before claiming. If two or more candidates genuinely survive
verification, put the choice to the operator via `AskUserQuestion` — label = title,
description = when it ran + what distinguishes it.

Deliver as a short card:

```
Found it: **<session-id>** — "<title>"

- **When:** <started> → <last_timestamp>
- **What it did:** <2–3 sentences: the original ask, the work done, how it ended>
- **Where it roamed:** <worktree/repo dirs, when load-bearing>

claude --resume <session-id>
```

Then one honest line on the **boundary** of what the session contains — e.g. "ends at the
commit; the PR itself was opened elsewhere" — so the operator isn't surprised on resume.
Runners-up, if any, get a single line each (id + why they're plausible).

Ephemeral — no report, nothing written. Read-only with respect to sessions: never resume,
kill, or send input to one yourself.
