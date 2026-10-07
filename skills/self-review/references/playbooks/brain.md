# Brain pass

The agent's data, not its rules: tasks nobody touches, projects gone quiet, memory lines that went false, decisions worth keeping, articles current state has outrun, and storage nobody needs. Only the operator knows whether something stale is still wanted, so this pass asks, one item at a time, with the evidence and a recommendation in front of them. It detects with a script, verifies on the machine, and applies each answer as it lands.

## Step 1 — Inventory

```bash
HOME_DIR="${KEVIN_HOME:-$PWD}"
PLUGIN_ROOT="<plugin root>"
bun "$PLUGIN_ROOT/skills/self-review/scripts/brain-audit.ts" --home "$HOME_DIR"
```

It prints JSON, writes nothing, and counts only. Every bucket is a date comparison:

| Bucket | Means |
|---|---|
| `tasks.stale` | open, active or blocked, untouched for 30 days; `dormant: true` when no operator turn has named its id for 60 |
| `tasks.activeOld` | active, filed 60+ days ago, still being touched. A trigger to read the thread, not proof of slow progress: `created` is when it was filed |
| `projects.dormant` | no task touched and no operator mention of the slug or its ids for 60 days |
| `memory.threads`, `memory.keyContext` | every line, ranked: tasks all closed (`signal: closed`), then unmentioned for 14 days (`quiet`), then no task signal (`none`) |
| `memory.pending` | every Pending line; each is a commitment, so each gets asked |
| `memory.openQuestions` | the `[stale]` gaps compile's gap pass flagged |
| `decisions` | archived decisions from the last 45 days that no pass has settled; any `asked` answer settles one. Most are already held by an article and are recorded silently |
| `articles` | concepts and user facets untouched for 60 days and unmentioned for 60 |
| `storage.captures` | captures older than 30 days (a folder by its newest file), one group per month with its exact `files` and `folders` |

"Operator mention" counts only `**User:**` turns, matched on whole words: the agent names overdue ids in its own output every day. A pasted report inside a user turn still counts, so treat a mention as a reason to look, never as proof of activity. Every keepable row carries a `key` and a `hash`; items kept within the last 90 days are already filtered out while their hash is unchanged.

When sync handed this pass a list of the flywheel's stalled tasks (sync step 13), those come first, whatever their age.

## Step 2 — Verify before asking

The script only detects. Before an item becomes a question, check it against the machine so the question carries real evidence:

- **Tasks.** `task_get` the ones you'll ask about; read the last thread entries. Say what you found ("last thread entry 06-12: waiting on the quote"), not just the age. For `activeOld`, ask about slow progress only when the thread shows it.
- **Memory lines.** A line with `signal: none` is asked only when checking it turns something up: a status the machine contradicts, a dead path or name, a fact a later session overtook. Otherwise leave it alone; Key Context lines rarely name a task, so this is how their facts get checked. For `closed`, confirm the task status. For Pending, check the artifact or task it names: a Pending item already done is a Drop with the receipt. For a status claim ("unpushed", "pending", a version), check the current state (git, the file, the latest session that mentions it) before asking.
- **Open Questions.** Find the source the gap is about (a task, a README, a concept, a memory line). A question you can't trace to a source gets asked as is.
- **Decisions.** Grep the concepts, user facets and project READMEs for each decision's key terms. Only a durable decision that no permanent article holds becomes a question; the rest stay archived silently.
- **Articles.** Read each one and compare its claims with current state. Bring specific contradictions ("says v0.4; the plugin is on 0.6"). With none found, the question is whether it's still accurate.
- **Captures.** Read the group's size and its file and folder counts; nothing else.

Drop any item verification shows is already handled: the operator never answers a question the machine already answered.

## Step 3 — Ask

Order, because a stale item costs most where it's loaded most:

1. The flywheel's stalled tasks, when sync handed any.
2. Memory lines: Active Threads, Pending, Key Context, Open Questions.
3. The work: dormant tasks, then stale ones, then old active ones, then dormant projects. Oldest first within each.
4. Decisions to promote.
5. Articles.
6. Capture months.

Ask 4 questions per call (`AskUserQuestion` under Claude Code; a numbered list per batch under Codex). Each question names the item, gives one line of evidence, and puts your recommendation first, marked `(Recommended)`. Apply each batch's answers before asking the next, so stopping early loses nothing. Apply them in this session, never through a subagent: the approval lives in this conversation, and a permission check that can't see it may refuse the write. After 6 calls (24 questions), ask **Continue** or **Stop here**. Whatever's left is asked first next month: the next inventory ranks the same items oldest first, minus what was answered.

| Item | Options → what you do |
|---|---|
| Stalled task (from sync) | The flywheel's step-9 options and effects: Push a week · Park · Blocked · Cancel |
| Stale or dormant task | **Keep, this month** → `task_update` with `horizon: "month"` · **Park** → `priority: "P3"`, `due: ""` · **Cancel** → `status: "cancelled"` · **Already done** → `task_close`; a `blocked` task gets `status: "active"` first, since blocked can't go straight to done |
| Old task, still active | **Keep** → no task change; recorded in Step 4 · **Park** (as above) · **Split** → draft the follow-up tasks in chat; `task_create` them only on a second yes |
| Dormant project | **Keep** · **Pause** → one status line at the top of its README, and offer Park for its open tasks · **Archive** → after the interview, run the project skill's archive playbook |
| Memory line | **Drop** · **Keep** · **Rewrite** (the operator's words, or your draft they approve) |
| Open Question | **Answer** → apply the answer to the question's source; the next sync's gap pass drops the question · **No longer relevant** → correct or remove the stale fact at its source · **Keep** |
| Decision | **Promote** → write it into the named article, with the date · **Leave it archived** |
| Article | **Rewrite** → apply your draft built from the contradictions · **Still accurate** · **Delete the section** (or the article, updating `knowledge/index.md`) |
| Capture month | **Keep** · **Delete** → the question states how many files and folders (a folder goes with everything in it). Remove exactly what the inventory listed, each absolute path written out in full: `rm -- '<file>' …` for `files`, `rm -r -- '<folder>' …` for `folders`. Never a glob or a built path. A folder belonging to another agent's home is deleted like any other, never moved |

A typed answer ("Other") is applied as stated, when it maps to an effect above. Otherwise, ask once to clarify. Never edit `## Learnings` or `## Open Questions` directly: a fix lands on the source, and compile does the rest. Quote every line you delete or rewrite, as it read before, for the report.

## Step 4 — Record

Merge into `<HOME>/.state/review.json`, keeping every other key:

```json
{
  "brainLastRun": "<today>",
  "asked": { "<key>": { "date": "<today>", "answer": "keep", "hash": "<hash>" } },
  "skips": 0
}
```

Add an `asked` entry for each **Keep** or **Still accurate** that changes nothing on disk: a memory line, an Open Question, an article, an old active task, a project, or a capture month. Use the row's `key` and `hash` exactly as the inventory emitted them, with `answer: "keep"` for either answer. A stale task kept with a horizon needs no entry, since setting it moves its `updated`; a plain Keep gets `task:<id>` with an empty `hash`. Record every decision the pass reached, with its `key` and `answer: "promote"` or `"leave"`, including those left silently because an article already holds them, so they are not checked again. Drop `asked` entries older than 90 days. Remove `snoozeUntil` and `skippedOn` if present. Write `brainLastRun` on Stop too: the leftovers come first next time anyway.

## Step 5 — Hand off to the report

Give the shared wrap (SKILL.md, Finish) a `## Brain` section:

- the decisions by kind with counts (kept, parked, cancelled, closed, dropped, rewritten, promoted, deleted), tallied from what landed (the task files and `asked` entries written this sitting), never from a running count;
- how many items are still waiting, and how old the oldest one is;
- promotions with their target articles;
- projects handed to archive;
- every deleted or rewritten line, quoted, for its `## Removed`.
