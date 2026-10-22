# Pulse — the queue at a glance (`/helpdesk pulse [slug]`)

What needs a person now, ranked, with the patterns across tickets, and the app's App Store reviews when the profile names one. A queue whose profile schedules `pulse` is nudged by sync until this playbook has written its report for the day, week or month.

These steps are the default. A profile's `## Pulse` section adds to them (extra checks, a different order, what the summary must say), or replaces them when its first line is `Replaces the default.`

## Steps

1. **Fetch.** `helpdesk_tickets` with the profile's `helpdesk` and `connection` (when set), `status` from its `statuses`, `since: "any"` (an open ticket matters whatever its age) and `limit: 200`. When it returns `more: true` the queue is bigger than the read: the header says `<N>+ open`, and the brief says the oldest open tickets weren't read. On Pylon, also `helpdesk_lookups` with `kind: teammates` once, to put names to assignees.
2. **Apply the rules.** Org rules first, then the profile's `## Triage`: a stream it says to collapse becomes one count line, and a ticket it routes to a known task links that task (find it with `task_query`) instead of being listed as new.
3. **Rank.** Unassigned first, then by how long the customer has waited: `last_activity_at`, else `updated_at`, oldest on top.
4. **Look for patterns.** Two or more tickets with the same error, feature, platform or account are the signal; name what they share. Read a ticket's thread (`helpdesk_ticket`) only when its subject can't settle it.
5. **Reviews**, only when the profile has `appstore`. `bun "<plugin root>/skills/helpdesk/scripts/review-reads.ts"` gives this queue's `since` (the last complete pulse or reviews read, else `7d`); then `appstore_reviews` with `app` from `appstore`, `storefronts` when the profile pins them, that `since` and `limit: 200`.
   - Give the rating counts, and group the reviews that describe the same break (a crash, a sync failure, one version) into patterns, matched against the ticket patterns from step 4. Read every review for this, whatever its stars: a 5-star review can report a bug.
   - Each bug pattern goes through [reviews](reviews.md) steps 2–7, so it reaches the operator as one card (or a comment on the open one) carrying its reviews, tickets and older reviews. A review that asks for a feature the profile raises joins the candidates in step 6, raised the way [raise](raise.md) says for a review.
   - Relay the tool's coverage as it gives it: storefronts that errored by name, storefronts with no reviews as a count. When it read nothing at all, the line is "Apple's feed was blank; reviews not read this time", never "no new reviews".
   - Never reply to a review. Nothing in the plugin can, and an App Store reply is public.
6. **To raise.** List the tickets that need work beyond a reply, each with its kind (bug, feature or task), leaving out any kind the profile's `## Raising` or `## Triage` sends nowhere. Raise each on the operator's yes, the way [raise](raise.md) says.
7. **Raised work where support has a part.** Take the lifecycle (the profile's `## Bug lifecycle`, else the [default](../lifecycle.md)) and, for each state whose support part isn't "nothing", find the cards and tasks in it:
   - **GitHub cards:** `github_issue_list` with `repo` from `## Raising` and `limit: 100`, once with `state: open` and once with `state: closed`; it can't filter, so pick the cards out of what it returns. Open cards carry the state's label. Closed ones count when their `updatedAt` is after the last pulse (the newest `reports/helpdesk/*-pulse-<slug>.md`), and `github_issue_view` says how each closed and its milestone. Only cards whose title names a ticket (`(ticket <id>)`) count; the card's tickets are every `ticket <id>` in its title, body and comments, since a card raised from reviews lists them in a Tickets section.
   - **Tasks:** `task_query` with the project and `includeClosed: true` (closed tasks are hidden otherwise), keeping tasks whose title names a ticket and whose `updated` is after the last pulse: `done` takes the closed-as-completed row, `cancelled` the closed-as-not-planned row.

   Before acting, read the ticket (`helpdesk_ticket`): skip it when a private note or a customer reply already came after the card's question or close, so a pulse never drafts the same reply twice. Then do that state's support part: usually a draft through the [draft](draft.md) playbook. Adding the user's answer to the card (`github_issue_comment`) or task (`task_thread`) waits for the operator's yes, with the answer's text shown and no contact details in it.
8. **Offer the drafts.** Tickets waiting on a reply, and the replies from step 7, can each get a draft through the [draft](draft.md) playbook. One yes covers the batch: each lands as a private note for a person to edit and send.
9. **Save.** Write the report, then show it in chat:

```
mcp__plugin_agent-kevin_kevin__report_write({
  category: 'helpdesk',
  slug: 'pulse-<slug>',          // just 'pulse' when there is no profile
  title: 'Helpdesk pulse — <slug>: <N> open, <K> unassigned',
  skill: 'agent-kevin:helpdesk',
  status: 'findings',            // 'clean' when nothing needs a person, 'critical' when a pattern looks like an outage
  body: <the brief below, no frontmatter>,
  tags: ['helpdesk', '<slug>'],
  extra: { open: <N>, unassigned: <K> }   // with reviews: reviews: <total> or 'blank', and reviews_through: <the tool's through> only when it says complete
});
```

The report file is the cadence watermark, so write it only for a complete scan: a pulse cut short by an error says so in chat and saves nothing. A reviews read that was blank or partial doesn't stop the save; it only leaves `reviews_through` out, so the next pulse reads from the last complete one.

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

Reviews: <total> since <since> (★1 <n> · ★2 <n> · ★3 <n> · ★4 <n> · ★5 <n>); <review patterns>; <coverage gaps>   (only with appstore; "Apple's feed was blank" when nothing was read)
Patterns: <only when two or more tickets share a cause; else omit>
To raise: <tickets with their kind, only when the profile raises them; else omit>
Questions from development: <cards asking the user something, each with its ticket; else omit>
Fixed since last pulse: <cards closed since the last pulse, each with its ticket; else omit>
Drafts: <the replies offered, or left as notes>
```

A quiet queue is one line: `🎫 <slug> — queue clear (nothing in <statuses>).`
