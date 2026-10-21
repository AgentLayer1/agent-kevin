## 🎫 Helpdesk: what I can do

Your support queue in SupportCandy or Pylon. I read, sort and draft; you send every reply. The Helpdesk pack unlocks it (`/agent-kevin:configure-skills` → Helpdesk), and the App Store pack adds an app's reviews to the pulse. A queue profile (`projects/<slug>/helpdesk.md`) holds your queue's own workflow: what the pulse does, how a bug moves, your routines, rules, tone and context.

| Ask | Playbook | You get |
|---|---|---|
| "What's in the support queue?", `/helpdesk pulse [slug]` | **pulse** | Open tickets ranked (unassigned and longest-waiting first), patterns across them, bug candidates, bugs fixed since last time with a reply to send, the app's App Store reviews when the profile names it, and a saved report |
| "Pull ticket 318", `/helpdesk ticket <id>` | **ticket** | The story so far: what the customer asked, what support said, internal notes apart, what's still open |
| "What's open for <account>?", `/helpdesk account <name>` | **account** | One account's tickets (Pylon) |
| "Draft a reply for 318", `/helpdesk draft <id>` | **draft** | A reply in your queue's tone, left as a private note once you approve it |
| "File 318 as a bug", `/helpdesk bug <id>` | **file bug** | A task, or a GitHub card with the repro, log excerpt and screenshots, wherever your profile files bugs |
| "Set up helpdesk for <project>", "tune the pulse", `/helpdesk setup [slug]` | **setup** | Access first when there's no connection it can read, then an interview that writes or tunes its queue profile: statuses, schedule, the pulse, the bug lifecycle, replies, context and your own routines |
| A routine from your profile, `/helpdesk digest [slug]` | **workflow** | Whatever that routine's steps produce, saved when it's scheduled |
