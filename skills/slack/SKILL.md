---
name: slack
description: >
  Read-only Slack, never posts. Triggers on "slack pulse", "what's happening in Slack", "pull this Slack thread",
  "search Slack for", "sort new channels".
allowed-tools: mcp__plugin_agent-kevin_kevin__slack_whoami, mcp__plugin_agent-kevin_kevin__slack_channels, mcp__plugin_agent-kevin_kevin__slack_history, mcp__plugin_agent-kevin_kevin__slack_batch_history, mcp__plugin_agent-kevin_kevin__slack_thread, mcp__plugin_agent-kevin_kevin__slack_search, mcp__plugin_agent-kevin_kevin__slack_waiting, mcp__plugin_agent-kevin_kevin__report_write, Skill(agent-kevin:configure-skills), Read, Write, Edit, Glob, AskUserQuestion
---

# Slack

Read-only access to Slack, built on the Slack pack's `slack_*` MCP tools (per-operator user-token OAuth, no DMs, no writes). This skill handles the **multi-channel composition** Kevin does on natural-language queries; the MCP tools do the reads.

**Reads go through MCP tools, not the `kevin slack` CLI over Bash.** The token lives under the deny-gated `.state/secrets/`, which the Bash sandbox can't read; the MCP server runs unsandboxed, so the tools read it fine.

| Read | MCP tool |
|---|---|
| Auth check | `slack_whoami` |
| List channels | `slack_channels` |
| One channel's history | `slack_history` (`channel`, `since`, `limit`) |
| Many channels at once | `slack_batch_history` (`channels[]`, `since`, `limit`, `outDir` for big scans) |
| A thread | `slack_thread` (`url`, or `channel` + `thread_ts`) |
| Search | `slack_search` (`query`, `in`, `since`) |
| What's waiting, and channels missing from the map | `slack_waiting` (`channels`, `since`, `after`) |

`kevin slack auth` stays a CLI command (interactive OAuth) that the operator runs from their own terminal, walked through by `/agent-kevin:configure-skills` → Slack. The skill never shells out for reads.

## Invocation

| Form | Behaviour |
|---|---|
| `/agent-kevin:slack` (no args) | **Full pulse.** Scan every categorised channel (excluding `Reference (opt-in)`) for the last 24h, filter for signal, compose the brief, save it to `reports/slack/`. |
| `/agent-kevin:slack <category>` | A pulse for one category, e.g. `/agent-kevin:slack external`. Same flow, narrower scope. |
| `/agent-kevin:slack sort new channels` | Only the diff-and-extend below, then a one-line report of what it filed. Sync's Slack-channels pick runs this. It reads channel names and topics, never messages. |
| `/agent-kevin:slack <freeform>` | Natural language: "what's stuck in #ext-acme", "search for INV-1042", "pull this thread <url>". Route to the right tool or flow per Composition below. |

Single-channel asks (`what happened in #team-eng today`) skip the multi-channel flow and go straight to `slack_history`.

## Pre-flight

Call `slack_whoami`. If it errors with an auth or refresh failure, say `Run kevin slack auth from your terminal first (or /agent-kevin:configure-skills → Slack)` and stop. An `EACCES`/`EPERM` deny-gate message means something shelled out to the CLI: use the `slack_*` tools instead.

## Source of truth: `<HOME>/knowledge/concepts/slack-channels.md`

The category → channel map is a markdown file the operator curates:

```markdown
---
title: Slack Channels
updated: <date>
---

# Slack Channels

How Kevin groups your Slack workspace. Auto-populated on first auth; new
channels you join land in **Uncategorized** for triage.

## Team
- team-eng
- team-ops — on-call and deploys

## External
- ext-acme — Acme Corp, shared channel
- ext-globex — Globex, shared channel

## Reference (opt-in)
- general
- industry-news

## Uncategorized
- ext-initech — joined 2026-01-15
```

**Parsing rule:** each `## <Section>` is a category; each `- <channel-name>` bullet (optional `— note`) is a channel. `Uncategorized` and `Reference (opt-in)` are built in: Uncategorized is the triage inbox, and Reference is left out of default scans unless the operator asks for it. The operator can add sections of their own.

**External channels.** `slack_waiting` (the attention queue's `External threads waiting`) scans the channels under **External**: channels shared with another organization, or with guests. It also returns `unmapped`, the channels you're in that this file doesn't list, so sync can flag a new join before it goes unchecked.

## Lifecycle

### First run: bootstrap the file (autonomous, review after)

If the file doesn't exist:

1. Call `slack_channels` (each entry has `name`, `id`, `is_private`, `topic.value`, `purpose.value`).
2. Classify each channel with the three tiers below.
3. Write the file. Confident placements go in their section; the rest go to `Uncategorized` with `— TODO categorise`.
4. Say one line: `Bootstrapped <PATH> — <N> channels (<X> categorised, <Y> in Uncategorized). Review and adjust if needed.` Don't paste the file.

### Every later run: diff and extend

Before any multi-channel operation (and as the whole job of `sort new channels`):

1. Read the file and call `slack_channels`.
2. Channels in Slack but not in the file are new joins. Classify each with the three tiers.
3. **Append, never overwrite.** A new channel goes into its matching section, or into `Uncategorized` with `— joined <date>`. Never move a channel out of a section the operator placed it in, and never rewrite their notes.
4. If the file changed, say one line: `Added <N> new channels (<X> auto-categorised, <Y> uncategorised).`

## Three-tier classification

First confident match wins. Use `topic` and `purpose` when the name misleads.

**Tier 1: strong name signals.**
- `eng | dev | platform | infra | code | incident | alerts | oncall | deploy | ci` → **Team**
- `ext- | -ext | shared | partner | client | customer`, or the channel is shared with another organization → **External**
- `general | random | announcements | industry-news` → **Reference (opt-in)**

**Tier 2: learn from the operator's own entries.** If `ext-acme` and `ext-globex` sit in **External**, a new `ext-initech` goes there too. Read the sections and infer the pattern; the operator's curation is the signal, not a fixed regex.

**Tier 3: topic and purpose.** If they plainly match a section, place it there. Still ambiguous → **Uncategorized**. Don't guess.

The tiers describe how a person would read the names, not hard rules: place by convention or by topic when the name alone misleads.

## Uncategorized ≥ 7

Before a multi-channel operation, count `## Uncategorized`. At 7 or more, ask first with `AskUserQuestion`:

> ⚠️ You have N uncategorized Slack channels (`foo`, `bar`, …). Triage them first, or scan with best guesses?

- **Triage now**: show each channel's name, topic and your guess; apply the operator's answers to the file in one batch.
- **Proceed best-effort**: use tier guesses for this query only, leave the file alone, and note "(N channels guessed at)".
- **Skip uncategorized this time**: scan the categorised channels only.

Below 7, include them silently under their likeliest category.

## Composition

"What's happening with external channels in the last day":
1. Read the map → the channels under **External**.
2. **One `slack_batch_history` call**: `{ channels: [...], since: '24h' }`. For big scans pass `outDir` (one JSON file per channel, a summary back) and read the files. Looping `slack_history` re-resolves the channel list each time; keep it for single channels.
3. Filter for signal: drop acks (`👍`, `ty`, `ok`), drop bot posts unless they're an incident, deploy or alert, drop threads the operator already answered. Keep unanswered questions, errors, asks, decisions and blockers.
4. Compose the brief by channel, most urgent first.

"Show me #ext-acme today" → `slack_history` with `{ channel: 'ext-acme', since: '1d' }`.
"Search Slack for INV-1042" → `slack_search` with `{ query: 'INV-1042', since: '7d' }`.
"Pull this thread <url>" → `slack_thread` with `{ url }`.

## Persisting the output

**Multi-channel pulses are saved with `report_write`**, then shown in chat:

```
report_write({
  category: 'slack',
  slug: 'pulse',                 // or the category: 'external', 'team'
  title: 'Slack pulse — last 24h, authed as @<operator>',
  skill: 'agent-kevin:slack',
  status: 'findings',            // 'clean' when nothing is actionable, 'critical' for a drop-everything item
  body: <the brief, no frontmatter>,
  tags: ['slack', 'pulse'],
  extra: { authed_as: '<operator>', workspace: '<workspace>', window: '24h', channels_scanned: <N>, channels_with_activity: <M> }
});
```

Show `📄 Saved to <path>` with the absolute `path` it returns. Single-channel reads, threads and searches aren't saved unless the operator asks. Anything durable a pulse turns up goes to `knowledge/raw/inbox/` (via `capture`) or a task; the report stays the snapshot.

## Output format

Channel names go in backticks with **no leading `#`**: Obsidian reads `#name` as a tag.

```
<agent emoji> Slack — <window>, authed as @<operator>

🤝 External (<N> channels, <M> threads)
  - `ext-acme` · @<user> · <iso>
    > <one-line summary>
    Action: <reply, file a task, hand to someone>

🧱 Team (<M> threads)
  - `team-eng` · @<user> · <iso>
    > <summary>
    Action: <…>
```

Skip empty categories. Nothing actionable: `Slack — all clear (<window>, <N> channels scanned).`

## Anti-patterns

- ❌ Reading DMs, or trying to. The token lacks the scope and the tools don't expose it.
- ❌ Searching for a file or attachment: `slack_search` doesn't index them, so a miss proves nothing. Ask for the message link.
- ❌ Shelling out to `kevin slack history|thread|search` for reads. Use the tools.
- ❌ Drafting replies to send. This skill surfaces; the operator decides and posts.
- ❌ Quoting more than one line of any message. Slack is a pointer, not a quote source.
- ❌ Moving channels the operator placed, or nagging about triage below 7 uncategorized.

## Refuse

- Posting, reacting or DMing: refuse; the tools are read-only and the token can't post.
- Channels the operator isn't in: surface Slack's `not_in_channel` and tell them to join first.

## Notes

- Every read logs to `<HOME>/.state/logs/app.log` under `[💬 slack]`.
- Refresh tokens expire after 30 days unused. A refresh error from `slack_whoami` means re-running `kevin slack auth`.
- The operator's edits to `slack-channels.md` are theirs: Kevin appends, never rewrites.
