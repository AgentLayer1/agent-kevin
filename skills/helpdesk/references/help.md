## 🎫 Helpdesk: what I can do

Your support queue in SupportCandy or Pylon. I read, sort and draft; you send every reply. The Helpdesk pack unlocks it (`/agent-kevin:configure-skills` → Helpdesk), and a queue profile (`projects/<slug>/helpdesk.md`) holds your own triage rules and tone.

| Ask | Playbook | You get |
|---|---|---|
| "What's in the support queue?", `/helpdesk pulse [slug]` | **pulse** | Open tickets ranked (unassigned and longest-waiting first), patterns across them, bug candidates, and a saved report |
| "Pull ticket 318", `/helpdesk ticket <id>` | **ticket** | The story so far: what the customer asked, what support said, internal notes apart, what's still open |
| "What's open for <account>?", `/helpdesk account <name>` | **account** | One account's tickets (Pylon) |
| "Draft a reply for 318", `/helpdesk draft <id>` | **draft** | A reply in your queue's tone, left as a private note once you approve it |
| "Set up a queue profile", `/helpdesk profile [slug]` | **profile** | A queue profile: which statuses count, how often sync nudges a pulse, your triage rules |
