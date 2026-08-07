---
name: evening-briefing
description: Tailored evening wrap — what shipped, what drafted, what stalled, goal-delta, and tomorrow's first move. Strict today-only scope; cheeky one-liner when the day is genuinely empty.
disable-model-invocation: true
allowed-tools: mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_scan, Read, Glob, Bash
---

# Evening Briefing

Close the day cleanly. Show what landed, name what didn't, flag what'll bite tomorrow if ignored. Match the morning's depth in shape — same number of sections, similar word budget (~350–550 words). Phone-screen of value, not a status report.

## Inputs (strict today-only scope)

1. **Today's raw sessions** — `Glob` `<HOME>/knowledge/raw/sessions/<today>*.md`. Read all flavors. **Do not** read prior-day session logs to fill bullets.
2. **Today's git activity** — `git -C <HOME> log --since='today 00:00' --oneline` and same for `<HOME>/projects` if separate gitdir.
3. **Today's project file deltas** — `find <HOME>/projects -type f -name '*.md' -newermt 'today 00:00' -not -path '*/node_modules/*'`.
4. **Closed today** — `mcp__plugin_agent-kevin_kevin__task_query` `{closed_on:"today"}` (or scan task frontmatter `closed:` for today's date).
5. **Active / open P0–P1** — `{status:"active"}`, `{status:"open", priority:"P0"}`, `{status:"open", priority:"P1"}`.
6. **Overdue / stale / blocked** — `mcp__plugin_agent-kevin_kevin__task_scan`.
7. **Goals** — read `<HOME>/projects/TASKS.md` `## Monthly Goals` and `## Weekly Goals` to compute end-of-day delta.

## Hard guardrails

- **Today-only.** If today produced no closures, no commits, no raw session, no project artifacts: **do not** silently drift to yesterday's content to satisfy a bullet quota. Trigger the cheeky-line fallback instead.
- **Cheeky-line fallback** — when `closed today = 0` AND no raw session for today AND no commits today AND no `projects/*` files touched today: output **only** the header + a single dry one-liner acknowledging the quiet day. No bullets. No sections.
- **Trust raw sessions + git + filesystem over the memory index** on conflicts. Memory compiles on a delay.
- **Surface artifacts in `📦 Drafted` even when no task closed.** New files / inbox captures / PRs / decisions in raw sessions count.
- **`✅ Shipped` is only landings.** PRs merged, tasks closed, deploys live, decisions locked. In-flight work goes in `🚧 Still in motion`, not here.

## Header — date (+ Hijri only if relevant)

Base header is plain Gregorian: `🌙 Evening Wrap · <weekday> <Mon DD>`.

**Append the Hijri date only when the operator follows the Islamic calendar — don't add it blindly for everyone.** Check for a faith/observance signal in `USER.md` (already in context) and `knowledge/user/profile.md` (the Faith field — read it once): Muslim, Islam, halal, Ramadan, prayer times, mosque, Hijri, and the like. If a signal is present, extend the header to `🌙 Evening Wrap · <weekday> <Mon DD>[ · <D> <Hijri month> <YYYY> — only if operator follows the Islamic calendar]`; otherwise ship the plain Gregorian header.

When including it, compute the Hijri date with this one-shot TypeScript conversion (Bun's bundled ICU provides the Umm al-Qura calendar — no dependency, no Python):

```bash
bun -e 'const tz="<USER_TZ>";const p=new Intl.DateTimeFormat("en-u-ca-islamic-umalqura",{day:"numeric",month:"long",year:"numeric",timeZone:tz}).formatToParts(new Date());const g=(t)=>p.find((x)=>x.type===t).value;console.log(`${g("day")} ${g("month")} ${g("year")}`)'
```

Substitute `<USER_TZ>` with the operator's **current** IANA timezone — the zone on the session context's `## Today` line (falls back to the home timezone in `USER.md` when that line is unavailable); drop the `timeZone` field if unknown. On failure, fall back to the most recent Hijri reference in `<HOME>/knowledge/memory/index.md` + day offset (±1 day), else omit the Hijri half — don't guess.

## Compose

```
🌙 Evening Wrap · <weekday> <Mon DD>[ · <D> <Hijri month> <YYYY> — only if operator follows the Islamic calendar]

✅ Shipped
  • <task-id or commit hash> — <what landed; merged / closed / deployed / decided>
  • ...
  (Landings only. 2–6 bullets. If zero true landings, omit section.)

📦 Drafted
  • <project-slug> — <artifacts created today that aren't closures: PRs opened, inbox captures, knowledge concepts added, threads opened, status flips>
  • ...
  (Group by project. Skip section if nothing drafted.)

🚧 Still in motion
  • <task-id>: <title> — <where you stalled / next concrete step / what's blocking>
  • ...
  (2–4 bullets. Each must name the next specific step, not just restate the task.)

⚠️ Stalled / overdue
  • <bundle stale + overdue + blocked items into 1–3 callouts; name the actual unblock>
  (Skip if clean.)

📈 Goals delta
  • Monthly: <theme> — <progress signal from today>
  • Weekly: <goal> — <closer / same / further; specific reason>
  (Only bullets that changed today. Skip section if no movement.)

💭 What I learned
  • <1–2 lines if a decision, insight, or correction emerged worth carrying forward>
  (Skip section if nothing crystallised. Don't manufacture insight.)

🌅 Tomorrow first move
  • <one concrete first action — the mechanical, blocked-on-nothing thing to open at 8am>

🍌
```

## Empty-day variant

When all four signals are zero (no closures, no commits, no raw session, no project artifact mtimes today):

```
🌙 Evening Wrap · <weekday> <Mon DD>[ · <D> <Hijri month> <YYYY> — only if operator follows the Islamic calendar]

<single dry one-liner — e.g., "Quiet one. Nothing shipped, nothing broke, nothing on fire. See you tomorrow." Vary the line each time. No bullets.>

🍌
```

## Persist

After rendering the wrap in chat, **also persist a snapshot** via the
`mcp__plugin_agent-kevin_kevin__report_write` MCP tool — the helper writes the
file and inserts a one-line entry into `<HOME>/reports/index.md` under today's
date in a single atomic call:

```
report_write({
  category: 'briefings',
  slug: 'evening',
  title: <e.g. 'Evening wrap — Sat May 23'>,
  skill: 'evening-briefing',
  body: <the full wrap, no frontmatter — exactly what was shown in chat>,
  status: <'clean' on the dry-one-liner day, 'findings' if anything material shipped or broke>
});
```

Surface `📄 Saved to <path>` (the absolute `path` the tool returns, not `relPath` — so it's command-clickable in any terminal) to the operator at the end of the wrap.

## Anti-patterns

- ❌ Listing every commit message. Group by what they accomplished.
- ❌ Padding `✅ Shipped` with already-in-progress work or yesterday's landings.
- ❌ Restating `## Active Threads` from `memory/index.md` verbatim. Evening is delta against today, not status quo.
- ❌ Drifting to yesterday's session log to fill bullets when today was thin. Use the cheeky-line fallback.
- ❌ Manufacturing `💭 What I learned` when nothing actually crystallised. Skipping the section is the right answer most days.
- ❌ Corporate tone. Talk to the user directly. Sharp, dry, no preamble.
