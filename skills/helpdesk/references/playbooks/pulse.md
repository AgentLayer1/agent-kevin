# Pulse — the queue at a glance (`/helpdesk pulse [slug]`)

What needs a person now, ranked, with the patterns across tickets. A queue with a `cadence` in its profile is nudged by sync until this playbook has written its report for the day, week or month.

## Steps

1. **Fetch.** `helpdesk_tickets` with the profile's `helpdesk` (when set), `status` from its `statuses`, `since: "any"` (an open ticket matters whatever its age) and `limit: 200`. On Pylon, also `helpdesk_lookups` with `kind: teammates` once, to name assignees.
2. **Apply the rules.** Org rules first, then the profile's `## Triage`: a stream it says to collapse becomes one count line, and a ticket it routes to a known task links that task (find it with `task_query`) instead of being listed as new.
3. **Rank.** Unassigned first, then by how long the customer has waited: `last_activity_at`, else `updated_at`, oldest on top.
4. **Look for patterns.** Two or more tickets with the same error, feature, platform or account are the signal; name what they share. Read a ticket's thread (`helpdesk_ticket`) only when its subject can't settle it.
5. **Bug candidates.** Where the profile's `## Filing bugs` says a ticket becomes a task, list the candidates. Create each with `task_create` only on the operator's yes: one task per bug, the ticket id in the description, and repro steps taken from the thread.
6. **Save.** Write the report, then show it in chat:

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
```

A quiet queue is one line: `🎫 <slug> — queue clear (nothing in <statuses>).`
