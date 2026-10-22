## 🎫 Helpdesk: what I can do

Your support queue in SupportCandy or Pylon. I read, sort and draft; you send every reply. The Helpdesk pack unlocks it (`/agent-kevin:configure-skills` → Helpdesk), and the App Store pack adds an app's reviews to the pulse. A queue profile (`projects/<slug>/helpdesk.md`) holds your queue's own workflow: what the pulse does, how a bug moves, your routines, rules, tone and context.

| Ask | Playbook | You get |
|---|---|---|
| "What's in the support queue?", `/helpdesk pulse [slug]` | **pulse** | Open tickets ranked (unassigned and longest-waiting first), patterns across them, tickets to raise as a bug, feature or task, cards closed since last time with a reply to send, the app's App Store reviews when the profile names it, and a saved report |
| "How many tickets came in today?", `/helpdesk stats [slug] [window]` | **stats** | Counts of the open tickets updated in the last 24 hours (or the window you name): by status, by tag, unassigned and newly opened. Numbers only; sync shows the same line |
| "Pull ticket 318", `/helpdesk ticket <id>` | **ticket** | The story so far: what the customer asked, what support said, internal notes apart, what's still open |
| "What's open for <account>?", `/helpdesk account <name>` | **account** | One account's tickets (Pylon) |
| "Draft a reply for 318", `/helpdesk draft <id>` | **draft** | A reply in your queue's tone, left as a private note once you approve it |
| "Any App Store bug reports?", `/helpdesk reviews [slug]` | **reviews** | New App Store reviews read for bug reports at every rating (a 5★ review can report one), each bug with its matching cards, tickets and older reviews gathered into one card or a comment on the card already open. Sync counts new reviews and offers it |
| "Raise 318", `/helpdesk raise <id>` (`/helpdesk bug <id>` for a bug) | **raise** | The ticket as a bug, a feature or a task, wherever your profile sends that kind: a task here, or a GitHub card with the repro, log excerpt and screenshots |
| "Set up helpdesk for <project>", "tune the pulse", `/helpdesk setup [slug]` | **setup** | Access first when there's no connection it can read, then an interview that writes or tunes its queue profile: statuses, schedule, the pulse, the bug lifecycle, replies, context and your own routines |
| A routine from your profile, `/helpdesk digest [slug]` | **workflow** | Whatever that routine's steps produce, saved when it's scheduled |
