# Backfill — priorities already posted in Slack

Slack connected only. Offer this once, on the first home refresh: "Want me to pull the priorities you and your leads have posted in Slack into tasks?"

1. Search for the operator's own priority posts and for lists others wrote for them. Try several phrasings: `priorities from:<@ID>`, `"this week" from:<@ID>`, `priorities <@ID>`, `to-dos <@ID>`, `goals for this week`. Open each hit with `slack_thread`, because the list is often updated in the replies.
2. Split each thread into items. Drop anything that's done (a later message, a merged PR, or a closed task says so), and dedupe across threads and against `task_query`.
3. Show the open items as a short table: the item, who asked, when it was first and last raised, and the matching task if any. Then triage them in batches ([add](add.md), step 5). Items that match an existing task get a horizon, not a duplicate.
