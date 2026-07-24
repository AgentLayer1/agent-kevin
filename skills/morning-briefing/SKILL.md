---
name: morning-briefing
description: Tailored morning brief — today's priorities, drafted artifacts, goals delta, per-project pulse, stale callout, signal-topic news, geopolitical news, and one concrete first move. Run when you sit down at the start of the day.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_get, mcp__plugin_agent-kevin_kevin__task_scan, mcp__plugin_agent-kevin_kevin__web_search, Read, Glob, Bash
---

# Morning Briefing

A single phone-screen of orientation: what matters today, what's moved since yesterday, where the world shifted on the topics that touch your work. The previous daemon-era briefing was rich on purpose — match that depth, not a 30-line summary.

Target: ~400–600 words, eight sections, one concrete first move, banana sign-off.

## Inputs to gather (parallelise where possible)

1. **Active threads + pending** — read `<HOME>/knowledge/memory/index.md` (`## Active Threads`, `## Pending`, `## Recent Decisions`).
2. **Today's raw sessions** — `Glob` `<HOME>/knowledge/raw/sessions/<today>*.md`. **Read all of them.** Same for yesterday's last session if briefing runs before any session today.
3. **Today's project deltas** — `Bash`: `find <HOME>/projects -type f -name '*.md' -newermt 'today 00:00' -not -path '*/node_modules/*'` to surface files touched today. Also `git -C <HOME> log --since='36 hours ago' --oneline` and `git -C <HOME>/projects log --since='36 hours ago' --oneline` (if a separate gitdir exists).
4. **Tasks**:
   - `mcp__plugin_agent-kevin_kevin__task_query` `{status:"active"}`
   - `{status:"open", priority:"P0"}` and `{status:"open", priority:"P1"}`
   - `mcp__plugin_agent-kevin_kevin__task_scan` for overdue / stale / blocked surfacing
5. **Goals** — read `<HOME>/projects/TASKS.md` `## Monthly Goals` and `## Weekly Goals` blocks. If empty, note the gap.
6. **Signal-topic news** — read `<HOME>/knowledge/user/profile.md` `## Signal Topics` (and `<HOME>/USER.md`). Run **2–4 targeted `web_search` calls in parallel**, one per topic cluster relevant *today*. Suggested clusters (pick the ones that matter for current Active Threads, skip the rest):
   - Pick clusters from the user's `## Signal Topics` (each topic or related-topic group becomes one query). Typical clusters: a competitive/industry cluster tied to the day job, a local-regulatory cluster (recency `"week"`, set `country` if applicable), an AI/tooling cluster covering the model ecosystem they build on, and a geopolitics cluster for events that touch their values or travel.
   - Use `recency: "day"` for fast-moving clusters, `recency: "week"` for slower regulatory ones.
   - **Capture the source URL for every result you might surface.** `web_search` returns citations/source links — keep the canonical URL alongside each candidate so it can be rendered as a clickable link in the brief. A signal with no source URL doesn't ship (see Signal gate).
   - **Apply the Signal gate below before any item earns a slot.** Most mornings, 0–2 signals clear it; that's correct, not a gap.
7. **Prior briefings (novelty check)** — `Glob` `<HOME>/reports/briefings/*.md` and read the entries from the **last 7 days**. This is what you de-dupe today's signals against. Read it *before* deciding which web_search results to surface.

## Signal gate (novelty + relevance)

Every candidate for `🌐 Signals` / `📰 News` must clear **both** gates. If nothing clears them, omit the section — a brief with no signals is a feature.

- **Relevance gate.** A signal earns a slot only if it touches something *actionable* or *tracked*: (a) it implies a concrete action this week, OR (b) it bears on something in `<HOME>/projects/TASKS.md` — an active/open task, a weekly goal, or a monthly goal. Ambient industry news that maps to no task and no this-week action does **not** qualify, however interesting.
- **Novelty gate (soft).** Compare each candidate against the last 7 days of briefings (input 7). If the same story already shipped, suppress it — *unless* a fact materially changed (a new number, a new decision, a status flip, a date that's now imminent). "X is still happening" / restating a known situation is never a signal. When you do re-surface a topic, lead with *what changed*, not the background.
- **Source gate.** Every `🌐 Signals` / `📰 News` item must carry a clickable source link (the canonical URL from the web_search result's citation). No URL, no slot — an unsourced signal is unverifiable and can't ship.

## Guardrails

- **Trust today's raw sessions over the memory index when they disagree.** Memory compiles on a delay; raw sessions are ground truth for <24h activity.
- **Surface artifacts in `📦 Drafted` even when no task closed.** New files in `projects/<slug>/` or `knowledge/raw/inbox/` written today count as progress.
- **Status verbs in `🏗️ Projects` must reflect what you observed in raw sessions + git + filesystem, not stale memory threads.**
- **Cheeky one-liner fallback** — if `closed today = 0` AND no raw session today AND no project artifacts modified today AND no commits today, skip the full structure and respond with a single dry/funny line acknowledging the empty day. Don't pad with yesterday's news.

## Header — date (+ Hijri only if relevant)

Base header is plain Gregorian: `🌅 Morning Brief · <weekday> <Mon DD>`.

**Append the Hijri date only when the operator follows the Islamic calendar — don't add it blindly for everyone.** Check for a faith/observance signal in `USER.md` (already in context) and `knowledge/user/profile.md` (the Faith field — read it once): Muslim, Islam, halal, Ramadan, prayer times, mosque, Hijri, and the like. If a signal is present, extend the header to `🌅 Morning Brief · <weekday> <Mon DD> · <D> <Hijri month> <YYYY>`. If there's no signal, ship the plain Gregorian header and skip the rest of this section.

When including it, compute the Hijri date with this one-shot TypeScript conversion. Bun's bundled ICU provides the Umm al-Qura calendar (`islamic-umalqura`) directly — no dependency, no Python:

```bash
bun -e 'const tz="<USER_TZ>";const p=new Intl.DateTimeFormat("en-u-ca-islamic-umalqura",{day:"numeric",month:"long",year:"numeric",timeZone:tz}).formatToParts(new Date());const g=(t)=>p.find((x)=>x.type===t).value;console.log(`${g("day")} ${g("month")} ${g("year")}`)'
```

Substitute `<USER_TZ>` with the operator's **current** IANA timezone — the zone on the session context's `## Today` line (falls back to the home timezone in `USER.md` when that line is unavailable); drop the `timeZone` field entirely if it's unknown. If the command fails for any reason, fall back to the most recent Hijri reference in `<HOME>/knowledge/memory/index.md` + day offset (lunar months alternate 29/30 days, ±1 day), and if still unknown omit the Hijri half and ship the Gregorian header alone — don't guess.

## Compose

```
🌅 Morning Brief · <weekday> <Mon DD>[ · <D> <Hijri month> <YYYY> — only if operator follows the Islamic calendar]

🎯 Today
  • <task-id> <P-level> — <crisp "why now"; deadline, dependency unlock, or fresh blocker>
  • <task-id> ...
  (3–6 bullets; mix P0/P1 active + the one P0 you should drop everything for. Inline-code task IDs.)

📦 Drafted
  • <project-slug> — <what moved yesterday/overnight that isn't a closed task: PRs, inbox captures, knowledge concepts, status flips, decisions>
  • <project-slug> — ...
  (Group by project. Pull from today's raw sessions + git log + new files. Skip section only if truly nothing drafted.)

📈 Goals
  • Monthly: <theme or "not set — N Hijri-month fires <date>"> — <status / risk>
  • Weekly: <goal> — <on-track / at-risk / blown, with the specific signal>
  • Weekly: ... (one bullet per weekly goal)

🏗️ Projects
  • <slug> — <one-line current state; what's the next material step>
  • <slug> — ...
  (Cover every project with movement this week. 4–6 lines.)

🕸️ Stale
  • <bundle stale/parked items into one or two callouts>; "<recommended action>: backlog sweep / accept they're parked / specific unblock"

🌐 Signals
  • <emoji> [<headline>](<source-url>) (<source/date>) — <"so what" tied to your work>
  • <emoji> ...
  (3–5 items pulled from the web_search calls. Lead each with a country / company / topic emoji. Headline is a clickable markdown link to the source.)

📰 News
  • <emoji> [<headline>](<source-url>) — <one-line why it touches your world>
  • <emoji> ...
  (1–3 items. Geopolitical / macro / Muslim world. Headline links to the source. Skip section if nothing material.)

👉 Today: <one concrete first action — the mechanical, blocked-on-nothing, prevents-the-next-outage move>

🍌
```

## Persist

After rendering the brief in chat, **also persist a snapshot** via the
`mcp__plugin_agent-kevin_kevin__report_write` MCP tool — the helper writes the
file and inserts a one-line entry into `<HOME>/reports/index.md` under today's
date in a single atomic call, and the SessionStart hook injects today's
section of the index so later sessions know the brief already ran:

```
report_write({
  category: 'briefings',
  slug: 'morning',
  title: <e.g. 'Morning brief — Sat May 23'>,
  skill: 'morning-briefing',
  body: <the full brief, no frontmatter — exactly what was shown in chat>,
  status: <'clean' on the dry-one-liner day, 'findings' if anything actionable surfaced>
});
```

Surface `📄 Saved to <path>` (the absolute `path` the tool returns, not `relPath` — so it's command-clickable in any terminal) to the operator at the end of the brief.

## Anti-patterns

- ❌ Dumping every active task. `🎯 Today` is 3–6 sharpest items, not a backlog.
- ❌ Running ONE web_search call to "cover everything" — the result is mush. Run a few **focused** queries, one per cluster you actually care about today.
- ❌ Restating Active Threads from `memory/index.md` verbatim. Briefing is *delta and direction*, not status quo.
- ❌ Including signals/news that are interesting but don't change today's plan or touch a TASKS.md item. Run it through the Signal gate; if the "so what" is generic, cut it.
- ❌ Re-reporting a signal you already delivered this week. Check the last 7 days of `reports/briefings/` first. Same story, no new fact = suppress. Repeating yourself is the fastest way to make the brief ignorable.
- ❌ A `🌐 Signals` / `📰 News` item with no clickable source link. Every item links to its source — bare claims fail the Source gate.
- ❌ Padding `📦 Drafted` with already-in-progress work. Yesterday's deltas only.
- ❌ Filling sections to look complete on an empty day. Use the cheeky-line fallback instead.
- ❌ Corporate tone or third person. Talk to the user directly. Sharp, a little dry, no preamble.
