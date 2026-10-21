# Pulse — the queue at a glance (`/helpdesk pulse [slug]`)

What needs a person now, ranked, with the patterns across tickets. A queue whose profile schedules `pulse` is nudged by sync until this playbook has written its report for the day, week or month.

These steps are the default. A profile's `## Pulse` section adds to them (extra checks, a different order, what the summary must say), or replaces them when its first line is `Replaces the default.`

## Steps

1. **Fetch.** `helpdesk_tickets` with the profile's `helpdesk` (when set), `status` from its `statuses`, `since: "any"` (an open ticket matters whatever its age) and `limit: 200`. On Pylon, also `helpdesk_lookups` with `kind: teammates` once, to put names to assignees.
2. **Apply the rules.** Org rules first, then the profile's `## Triage`: a stream it says to collapse becomes one count line, and a ticket it routes to a known task links that task (find it with `task_query`) instead of being listed as new.
3. **Rank.** Unassigned first, then by how long the customer has waited: `last_activity_at`, else `updated_at`, oldest on top.
4. **Look for patterns.** Two or more tickets with the same error, feature, platform or account are the signal; name what they share. Read a ticket's thread (`helpdesk_ticket`) only when its subject can't settle it.
5. **Bug candidates.** List the tickets the profile's `## Filing bugs` says become bugs, then file each on the operator's yes, the way [filing a bug](file-bug.md) says.
6. **Filed bugs where support has a part.** Take the lifecycle (the profile's `## Bug lifecycle`, else the [default](../lifecycle.md)) and, for each state whose support part isn't "nothing", find the bugs in it:
   - **GitHub cards:** open cards with that state's label (`github_issue_list`), and cards closed since the last pulse (the newest `reports/helpdesk/*-pulse-<slug>.md`; `state: closed`, then `github_issue_view` for how each closed). Only cards whose title names a ticket (`(ticket <id>)`) count.
   - **Tasks:** `task_query` for the project's tasks closed since the last pulse that cite a ticket: `done` takes the closed-as-completed row, `cancelled` the closed-as-not-planned row.

   Do that state's support part for each: usually a draft for its ticket through the [draft](draft.md) playbook, or adding the user's answer to the card (`github_issue_comment`) or task (`task_thread`).
7. **Offer the drafts.** Tickets waiting on a reply, and the replies from step 6, can each get a draft through the [draft](draft.md) playbook. One yes covers the batch: each lands as a private note for a person to edit and send.
8. **Save.** Write the report, then show it in chat:

```
mcp__plugin_agent-kevin_kevin__report_write({
  category: 'helpdesk',
  slug: 'pulse-<slug>',          // just 'pulse' when there is no profile
  title: 'Helpdesk pulse — <slug>: <N> open, <K> unassigned',
  skill: 'agent-kevin:helpdesk',
  status: 'findings',            // 'clean' when nothing needs a person, 'critical' when a pattern looks like an outage
  body: <the brief below, no frontmatter>,
  tags: ['helpdesk', '<slug>'],
  extra: { open: <N>, unassigned: <K> }
});
```

The report file is the cadence watermark, so write it only for a complete scan: a pulse cut short by an error says so in chat and saves nothing.

## Output

```
🎫 <slug> — <N> open (<status>: <n>, …), <K> unassigned

🔴 Needs a person now
  - #<number or id> · <account> · <age> · unassigned
    > <one line: what the customer needs>

🟡 Waiting on us
  - #<number or id> · assigned <teammate> · last activity <when>
    > <one line>

<collapsed streams, one count line each, per the triage rules>

Patterns: <only when two or more tickets share a cause; else omit>
Bug candidates: <only when the profile files bugs; else omit>
Questions from development: <cards asking the user something, each with its ticket; else omit>
Fixed since last pulse: <cards closed since the last pulse, each with its ticket; else omit>
Drafts: <the replies offered, or left as notes>
```

A quiet queue is one line: `🎫 <slug> — queue clear (nothing in <statuses>).`
