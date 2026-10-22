# Reviews — App Store bug reports become one card each (`/helpdesk reviews [slug]`)

New App Store reviews read for bug reports, each bug gathered with everything already known about it (cards, tickets, older reviews) into one card. Needs `appstore` in the profile. Sync counts new reviews and offers this playbook; the pulse runs steps 2–7 for the reviews it reads.

## Steps

1. **Read.** `bun "<plugin root>/skills/helpdesk/scripts/review-reads.ts"` gives the queue's `since`: the last complete read's `through`, else `7d`. Then `appstore_reviews` with `app` from `appstore`, `storefronts` when the profile pins them, that `since` and `limit: 200`. Relay coverage the way the [pulse](pulse.md) does; a blank read ends here with "Apple's feed was blank; reviews not read this time" and saves nothing.
2. **Pick the bug reports by what the review says, never by its stars.** People who love the app report bugs and still leave five stars, so read every review in the window and never filter by rating. A review is a bug report when it says something breaks: wrong times, a missing alert, a crash, lost settings. A feature ask goes where the profile sends features. The profile's `## Raising` version rules apply by the review's app version: a review from a version it doesn't raise still joins a cluster as context, but never opens a card on its own.
3. **Cluster** the bug reports that describe the same break, by symptom and version rather than wording.
4. **Gather what's already known**, per cluster, within these bounds:
   - **Cards.** `github_issue_list` on the repo from `## Raising`, once `state: open` and once `state: closed`, `limit: 100` each; it can't search, so match by title, then `github_issue_view` only the candidates.
   - **Tickets.** `helpdesk_tickets` with the profile's `helpdesk` and `connection`, `search` set to one or two key terms of the break (try a second phrasing when the first finds nothing), `since: 90d`, `limit: 20`. Read a thread (`helpdesk_ticket`) only when the subject can't settle whether it's the same break.
   - **Older reviews.** One wider `appstore_reviews` read for the whole run (`since: 90d`, every rating, `limit: 500`), matched to the clusters.
   - **Tasks.** `task_query` in the profile's project, for work already planned on it. Name a matching task in chat only: task ids mean nothing on GitHub.
5. **Offer each cluster** with `AskUserQuestion`, up to four clusters per call: **Open a card** · **Comment on #n** (when an open card matches) · **Skip**. An open card that matches always gets a comment, never a second card. A closed card that matches is linked as related; when the reviews came on a version after the one it was fixed in, say so, since the fix may not have held.
6. **Draft it and show it** before any write, following [raise](raise.md)'s rules for a review:
   - **Title:** what breaks, then `(ticket <id>)` naming the first related ticket, else `(App Store reviews)`, so the pulse can match the card to its tickets when it closes.
   - **Body**, in this order: one paragraph on the break; the versions and devices seen; **Reviews**, each in a blockquote with its rating, app version, storefront and date, never the nickname; **Tickets**, one `ticket <id>` line each with its link, never the customer's name, email or account; **Related issues** as `#n`; repro steps when the reviews or tickets give them.
   - **A comment** on a matching card carries the same Reviews and Tickets sections, only the new ones.
7. **Write it on a yes**: `github_issue_create` with the lifecycle's first state as its label plus any the profile gives bugs, or `github_issue_comment`. Then offer the trail: a private note (`helpdesk_note`) on each related ticket naming the card, one yes for the batch.
8. **Save.** A complete read is the next read's starting point:

```
mcp__plugin_agent-kevin_kevin__report_write({
  category: 'helpdesk',
  slug: 'reviews-<slug>',
  title: 'App Store reviews — <slug>: <total> new, <n> bug reports',
  skill: 'agent-kevin:helpdesk',
  status: 'findings',            // 'clean' when no review reports a bug
  body: <the output below>,
  tags: ['helpdesk', '<slug>', 'appstore'],
  extra: { reviews: <total> }    // and reviews_through: <the tool's through> only when it says complete
});
```

## Output

```
⭐ <slug> — <total> reviews since <since> (★5 <n> · ★4 <n> · ★3 <n> · ★2 <n> · ★1 <n>); <coverage gaps>

🐞 <the break> · <n> reviews (★… spread) · versions <…>
   Cards: #<n> open | #<n> closed in <milestone> | none
   Tickets: <id>, <id> | none found for "<terms>"
   Older reviews: <n> since <date>
   Tasks: <id> | none
   → <opened #n | commented on #n | skipped>

Not bugs: <n> praise · <n> feature asks · <n> other
```
