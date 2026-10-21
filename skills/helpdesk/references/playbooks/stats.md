# Stats — the queue in numbers (`/helpdesk stats [slug] [window]`)

Counts of the queue's tickets updated within a window, default the last 24 hours: by status, by tag, unassigned, and how many opened in the window. `helpdesk_stats` returns numbers and the workspace's own status and tag names only, never ticket text, which is why sync can run it unattended. It counts from a read of the tickets themselves, so the window is what keeps it cheap; a wider one (`7d`, `30d`) reads more pages.

## Steps

1. **Pick the queues.** A slug in the ask is that profile's queue. With none, count every queue, the way sync does:
   - each queue profile, with its `helpdesk`, `connection` and `statuses`;
   - then each connection `helpdesk_connections` lists that no profile read (compare each reply's `helpdesk`): the no-project default, or a project's connection whose setup hasn't run. Pass no statuses: Pylon counts its open statuses, SupportCandy every status.
2. **Count.** `helpdesk_stats` per queue, with `since` from the ask (`24h`, `72h`, `7d`), else its default.
3. **Show it.** No report: a count is a glance, not a cadence watermark.

## Output

```
🎫 <slug | no project | <connection>, no profile yet>, last <window>: <total> <open | all-status> tickets active (<status> <n> · …) · <unassigned> unassigned · <openedInWindow> opened in the window
   Tags: <tag> <n> · … (top six, then "other <n>")
```

When `more` is true the total is a floor: write it as `<total>+`. An empty window is one line: `🎫 <slug>, last <window>: no open tickets active.`
