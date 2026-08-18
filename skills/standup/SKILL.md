---
name: standup
description: Build the operator's standup update in the three parts a standup has — what they did in the last 24h (merged PRs, prod actions taken by hand, investigations that left no commit, tasks filed), what they're picking up next, and what's blocked or needs a decision from someone in the room. Derives all three from git, PRs, session transcripts and the task board rather than asking. Crosses the day boundary a standup does, and flags older work a skipped run may have left unsaid. Use when the operator says "standup is coming up", "what have I done", "what did I do yesterday", "summarise my work for standup", "I need my update", or invokes /agent-kevin:standup. Accepts an hours override (`/agent-kevin:standup 48`).
allowed-tools: Bash, Read, Glob, mcp__plugin_agent-kevin_kevin__github_pr_list, mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__report_write
---

# standup — did, next, blocked

The operator is about to speak to other people. A standup is three parts and the update carries
all three:

```
Did      what actually happened, with its evidence
Next     the ≤3 things they're picking up, derived not invented
Blocked  what's stopped, who owns clearing it, how long it's waited
```

Act one is **past tense, attributable, and safe to be wrong about in public** — nothing gets
upgraded from "built" to "shipped" for narrative convenience. Acts two and three are the half
the room can act on, and they're the half a status report leaves out.

This is not the evening briefing. Four differences, and together they're why the skill exists:

| | `evening-briefing` | `standup` |
|---|---|---|
| Window | strict today-only | **last 24h**, so it crosses the day boundary |
| Audience | the operator | the operator's teammates |
| Sources | git + tasks + prod | git + tasks + prod **+ sessions + hand-run ops** |
| Forward half | one "tomorrow first move" | `Next` + `Blocked`, named owners and ages |

The sources row is the load-bearing one. A day's most valuable work often leaves no commit: an
investigation that found a production bug, a SQL statement applied to prod by hand, a teammate's
question answered. Git cannot see any of it. Only the session transcripts can.

## Step 1 — fix the window

```bash
find "${KEVIN_HOME:-$AGENT_HOME}/reports/briefings" -name '*-standup.md' 2>/dev/null | sort | tail -1
```

(`find` with a quoted pattern, not a shell glob — zsh aborts the command outright when a bare
glob matches nothing, so `ls .../*-standup.md` fails instead of falling through on a first run.)

**The window is 24 hours.** Not "since the last report" — a missing report means the skill
didn't run, which is not the same event as standup not happening. Most of the time standup
happened anyway and the work is already spoken for, so anchoring on the report would make the
operator re-announce days of it. Only an explicit `/agent-kevin:standup 48` widens the window.

That file still earns its lookup, for one thing: it tells you whether there's a **gap**. Read
its `created:` and compare against the 24h boundary.

| Gap | What to do |
|---|---|
| ≤ 24h, or no gap | nothing; the window covers everything |
| > 24h | keep the 24h body, and add a compact `⏸ Before this window` tail (Step 5) |

The tail is what keeps the cap honest. If standup genuinely was skipped on Monday, Monday's
work is still on the screen for the operator to pull in — one line each, no session reading, so
it costs almost nothing. If standup did happen, they skip the section. Either way nothing
disappears without being seen, which a bare cap cannot promise.

- **No prior standup report at all** → plain 24h, no tail. A first run has no gap to report.
- **Never widen the window silently** to swallow the gap. The cap is the contract; the tail is
  the escape hatch.

Compute the window once in all three forms it's consumed in: an **ISO timestamp** for
`git --since`, a **whole number of hours** for the session script's `--hours` (round *up*, so
the boundary session isn't clipped), and a **day-label** for the header. Getting the hours wrong
is the quiet failure here: it drops sessions, and a dropped session is exactly the un-diffed
work nothing else can see.

## Step 2 — gather, in parallel

Fire all of these in one batch. Each is independently degradable: a source that errors gets a
named gap in the output, never a guess.

**1. Sessions** — the only source that sees uncommitted work, investigations, and prod actions:

```bash
SCOPE="${KEVIN_HOME:-$AGENT_HOME}"
[ -n "${KEVIN_CODE_PATH:-$AGENT_CODE_PATH}" ] && SCOPE="$SCOPE,$(dirname "${KEVIN_CODE_PATH:-$AGENT_CODE_PATH}")"
bun "${CLAUDE_PLUGIN_ROOT}/skills/where-am-i/scripts/list_sessions.ts" --hours <N> --scope "$SCOPE"
```

Two things about this JSON that will mislead you if you don't know them:

- **Scope keys on the session's launch directory, not its `cwd`.** Sessions launched from the
  agent HOME routinely `cd` into a worktree and do all their work there, so the HOME root is
  *not* optional in `--scope` — drop it and you go blind to most of the day. Conversely the
  `cwd` field is the *drifted* directory, which is what makes it useful: it names the worktree
  the work actually happened in.
- **`minutes_ago` is transcript-derived**, so recency is trustworthy. (It used to come from
  file mtime, which a `git checkout` or a backfill silently moved forward.)

Read the transcript tail (`tail -c 80000 <file>`) for any session whose snippets don't say
what it accomplished. Standup is a claim-making surface; a padded guess is worse than
spending another 80KB.

**2. What landed on main** (theirs and everyone's — you need both to tell them apart):

```bash
REPO="${KEVIN_CODE_PATH:-$AGENT_CODE_PATH}"
ME=$(git -C "$REPO" config user.email)
git -C "$REPO" log main --since='<ISO>' --pretty='%h|%an|%ai|%s'
git -C "$REPO" log --all --author="$ME" --since='<ISO>' --pretty='%h|%ai|%d %s'
```

Filter on the configured **email**, never `--author='@me'` — that's a `gh` idiom and git reads
it as a literal regex, so it silently matches nothing and the section comes back empty. Email
is also the stable key: the same person commits under several display names.

**3. Their PRs** — `github_pr_list` with `state: all`. This, not local branch reachability, is
what decides whether something landed: a squash merge leaves the branch looking unmerged and
attributes the main-branch commit to whoever pressed the button.

**4. Uncommitted work**, the thing most likely to get over-claimed out loud:

```bash
REPO="${KEVIN_CODE_PATH:-$AGENT_CODE_PATH}"
for W in $(git -C "$REPO" worktree list --porcelain | awk '/^worktree /{print $2}'); do
  printf '%s: ' "$W"; git -C "$W" status --porcelain | wc -l
done
```

`REPO` is re-derived here on purpose: these blocks run as separate (often parallel) Bash calls,
which don't share shell state — and an empty `$REPO` doesn't error, because `git -C ""` silently
falls back to the cwd and audits the wrong repo as "nothing uncommitted".

**5. Tasks and goals** — `task_query` for tasks **closed inside the window** (act one — the 24h
window crosses midnight, so "today" alone drops a task closed yesterday evening) plus
`{status:"active"}` and open P0/P1 (act two), and `task_scan` for overdue/blocked (act three).
Also read `<HOME>/projects/TASKS.md` → `## Weekly Goals`, which is what makes a long active list
rankable. Tasks created or touched inside the window are output too:

```bash
find "${KEVIN_HOME:-$AGENT_HOME}/projects" -path '*/tasks/*' -name '*.md' -newermt '<ISO>'
```

**6. Reports written in the window** — `Glob` `<HOME>/reports/*/` for **both dates the window
touches** (`<yesterday>*` and `<today>*` — a single-date glob silently misses last evening's
health sweep). A report *is* an accomplishment, and it's where the evidence for the findings lives.

**7. The HOME repo**, for brain-side work:

```bash
git -C "${KEVIN_HOME:-$AGENT_HOME}" log --since='<ISO>' --oneline
```

This one can fail (the HOME git dir is split and lives outside the sandbox on some setups).
Fall back to `find <HOME>/knowledge <HOME>/projects -newermt '<ISO>'` rather than dropping the
section.

**8. The gap, only when Step 1 found one** — the same PR, main-log and task queries re-run over
**last-standup-timestamp → the 24h boundary** (exclusive of the body's window — anything newer is
already in the body, and an item appearing in both `Shipped` and the tail reads as more work than
happened). Landings only; skip the session scan and the worktree walk. The tail is a
"here's what's older, in case it never got said" list, not a second standup, and keeping it to
three cheap queries is what makes the cap affordable to be honest about.

## Step 3 — classify before composing

The single failure mode of a spoken update is claiming more than happened. So sort every item
onto this ladder first, and let the ladder pick the section:

```
merged + deployed + verified in prod   → 🚢 shipped        (say it plainly)
merged, not yet verified               → 🚢 shipped        (lead with "not verified yet")
PR open / pushed                       → 🔧 in flight      (name the review state)
committed locally, unpushed            → 🔧 in flight      ("built, unpushed")
uncommitted in a worktree              → 🔧 in flight      ("built, uncommitted")
found but not fixed                    → 🔴 found
a decision, an answer, a doc, a task   → 📋 filed
```

Then two attribution passes, both of which are easy to get wrong and embarrassing to get wrong
out loud:

- **Drop teammates' work.** A merge commit on main authored by someone else is theirs even if
  the operator reviewed it. Reviewing is worth a mention; it isn't a landing.
- **Hunt the un-diffed work explicitly.** Re-read the session set asking only: *what changed in
  the world that has no commit?* Hand-run SQL against prod, a call taken, an env flip, a
  verification that a deploy was clean, an answer to a teammate's question. These are usually
  the highest-value items in the update and they are invisible to every other source.

## Step 4 — derive next and blocked

The forward half is not a second gather; it's read off what act one already produced, plus two
board queries. Deriving beats asking: the operator called this skill because they don't want to
assemble the update themselves.

**Next — at most three, and each must be evidence-backed.** In priority order, the candidates
are:

1. **The obvious continuation of in-flight work** — a PR that came back with review comments, a
   branch built but unpushed, a plan written but not coded. Strongest signal there is, because
   the operator already chose it by starting it.
2. **The blocking-question answer that arrived** — something act one was waiting on that has
   since been unblocked.
3. **The board, ranked by the goals** — the active/P0-P1 tasks and Weekly Goals already gathered
   in Step 2.5. The goals say which of a long active list actually earns the slot.

Rules for this section, because it's the easiest place to write something useless:

- **Finishable-shaped, not a theme.** "Push the loop-claim fix and get it reviewed" is a next.
  "Work on payment reliability" is not.
- **Three maximum.** A standup where someone lists eight plans is a standup nobody believes.
  Rank and cut; the board is not the update.
- **Never invent one.** If in-flight work and the goals genuinely don't point anywhere, say what
  the real state is ("nothing queued; I'd take direction on what's most useful") and move the
  uncertainty into `❓ Open questions`. A fabricated plan is a commitment made on the operator's
  behalf to people who will hold them to it.

**Blocked — the discipline is that a blocker names a person or an external party.** "I haven't
finished it" is a next, not a blocker. Candidates:

1. **`task_scan`** → `blocked` and `overdue` items, with `blocked_by` naming the external wait.
2. **PRs open and unreviewed** past a day: the reviewer is the blocker, and they're often in the
   room.
3. **Decision-pending sessions** — a session whose `last_assistant_text` ends by asking the
   operator something is *self*-blocked, which belongs in `Next`, not here. But a session
   waiting on a *third party* (a vendor's answer, a teammate's schema call) is a real blocker.
4. **Questions raised in act one** that gate real work, from the findings and filed tasks.

Each blocker carries **who**, **what's stopped**, and **how long**. The duration is what turns a
standing item into an escalation, and it's the reason to say it out loud again rather than
letting it sit in a task for the fourth week.

## Step 5 — compose

The operator reads this **while talking**. They will never read a paragraph mid-sentence, so the
update is two layers with a hard line between them:

- **The card** — everything above the `---`. One line per item, bold spoken lead first. This is
  the whole standup; it must survive being glanced at in half-second increments.
- **The backup** — everything below. Evidence, mechanisms, numbers with provenance. Read only
  when someone asks a follow-up, so depth goes here and never above the line.

Steps 2–3 fill `Did`, Step 4 fills `Next` and `Blocked`. Skip any section that is genuinely
empty — a standup with three real items beats one padded to seven.

```
## Standup — last 24h (<since-label> → <today>)

> <one sentence tying the window together: the thing that mattered most.>

SHIPPED ███ 3   IN FLIGHT ██████ 6   FOUND ██ 2   FILED ██ 2   BLOCKED ██ 2

## Did

- 🚢 **#474 merged + verified** · <the PR title, verbatim> — <reminder clause: what it was about / why it mattered>
- 🚢 **#475 merged, ⚠️ not verified yet** · <title> — <reminder>
- 🎛️ **By hand, prod** · <the action in its own words> — <that it held, and for whom>
- 🔴 **FOUND: <impact-first, e.g. "duplicate sends — retry race in the acme webhook">** — fix built, unpushed
- 🔧 **#478 open, awaiting review** · <title> — <reminder>
- 🔧 **Built, uncommitted** · `<user>/<branch>` — <what it is and what it's waiting on>
- 📋 **<task-id> filed** · <task title> — <the blocking question, if it has one>

### ⏸ Before this window
*Last standup was <day>; these may never have been said:*
- **#<PR>** <title> · <day>

## Next

1. **<verb-first, finishable>** — <what done looks like, one clause>
2. **<second>**

## Blocked

| Who | What I need | Since |
|---|---|---|
| **<name>** | <the question, as you'd ask it> | 5d |
| **<vendor>** | <what can't proceed> | 12d |

- ❓ <open question for the room, not blocking yet>

---
## 📎 Backup — if someone asks

**#474** — <the evidence: what was checked in prod, the number, the query>
**<the 🔴 finding>** — <mechanism, ASCII block if it earns one, provenance of every number>
**<blocker>** — <the context you'd give if pressed>
```

Rules:

- **Each item is three parts on one line: status · title · reminder.** The bold lead is the
  status the operator speaks ("merged + verified"); the title is **verbatim from the PR or
  task** — it's the recall hook, they've been staring at it all week, and a paraphrase forces
  them to *remember* mid-sentence instead of *read*; the reminder is one clause of what it was
  about. Wrapping is fine — one *item* per line, not one screen-line.
- **Terse past recognition is as bad as prose.** If the operator has to reconstruct what an item
  was, the compression failed. What stays out of the card is *depth* (mechanism, evidence,
  numbers' provenance), not *identity*.
- **~12 items of card total.** Beyond that, group ("plus 4 smaller acme follow-ups — backup
  has the list") and push the rest below the line.
- **The 🔴 finding gets one line up top, impact-first.** The mechanism, the table, the ASCII —
  all backup. The room needs "duplicate sends, four affected, fix built"; the *how* is for the
  follow-up.
- **Through-line first.** One `>` sentence. It's what they say if they say nothing else.
- **Status is part of the bold lead**, not a trailing qualifier: "**merged, not verified**" gets
  spoken; a ⚠️ at the end of a long line gets missed mid-presentation.
- **Numbers carry units and provenance** — in the backup. "214 requests across 3 days, most
  recent 08-06" with the report cited. The card carries the number alone.
- **Name people.** "Ask Alex which env the flag reads from" is actionable; "clarify requirements"
  is not. This applies to blockers most of all — an unnamed blocker never gets cleared.
- **The three acts are not optional, but their items are.** `Next` empty means say so honestly;
  `Blocked` empty is the good day. Never drop an act's heading; never pad one to fill it.
- **`⏸ Before this window`**: one line per item, ~6 max (beyond that, a count plus the two
  biggest and a pointer at the prior report), and omit the section entirely when there's no gap —
  which is most days.
- **Prose is for the room.** No internal file paths; task ids and PR numbers instead. If a
  teammate wouldn't recognise the noun, rename it.

## Step 6 — persist

Not optional: this report is the only thing that lets the *next* run detect a gap, and it's what
the operator reaches for when someone asks "what did you say last time?"

```
report_write({
  category: 'briefings',
  slug: 'standup',
  title: <e.g. 'Standup — 3 shipped, acme double-send found, port-status PR opened'>,
  skill: 'standup',
  body: <the full update, no frontmatter — exactly what was shown in chat>,
  status: <'critical' if a finding needs the room today, 'findings' normally, 'clean' if the window was quiet>
});
```

Surface `📄 Saved to <path>` (the absolute `path`, not `relPath`) at the end.

## Quiet-window variant

When the window produced no landings, no commits, no prod actions and no findings: the
through-line, one line of what the time went to (meetings, reading, a blocked thread), then
`Next` and `Blocked` in full. Those two acts are usually *more* valuable on a quiet day, not
less — a day with nothing shipped and nothing blocked reads very differently from a day with
nothing shipped because three things are waiting on other people. Skip the `Did` sections rather
than padding them. A thin standup is a legitimate standup; a fabricated one costs the operator
credibility the next time they're specific.

## Anti-patterns

- ❌ Calling built-but-unpushed work "shipped". The single worst failure here.
- ❌ Listing commits. Group them by what they accomplished; nobody wants a `git log`.
- ❌ Claiming a teammate's merged PR because the operator reviewed it.
- ❌ Reporting only what git can see, and losing the prod action and the investigation.
- ❌ Shipping a did-only update. Without `Next` and `Blocked` it's a status report, not a standup,
  and the blockers are the half the room can actually act on.
- ❌ Reading the task board out as `Next`. Three items, ranked against the weekly goals.
- ❌ Filing "I still have to write it" as a blocker. A blocker names a person or an external party.
- ❌ Inventing a plan to avoid an empty `Next`. Say there's nothing queued and ask.
- ❌ Dropping a blocker's age. Four weeks of waiting is the entire argument for raising it again.
- ❌ Narrowing `--scope` to the code tree because the work was code work. Sessions are keyed on
  launch directory; most of them launch from HOME.
- ❌ Widening past 24h because a lot happened, or dropping the `⏸` tail because the cap "handles
  it". The cap is the window; the tail is what makes capping safe.
- ❌ Restating `memory/index.md` active threads. Standup is the delta, not the standing state.
- ❌ Paragraphs above the `---`. The operator is mid-sentence when they look down; anything that
  needs reading (vs glancing) belongs in the backup.
- ❌ Compressing an item past recognition. A bare "#474 merged" makes the operator reconstruct
  what #474 *is* while talking — the verbatim title and a reminder clause stay on the card;
  only depth moves to backup.
- ❌ Burying an item's status at the end of its line. "merged, not verified" is the bold lead,
  not a trailing footnote.
- ❌ Manager-speak ("circled back", "drove alignment"). Say what happened.
