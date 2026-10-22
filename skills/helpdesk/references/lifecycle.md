# Default bug lifecycle

What each state of a raised bug, feature or task means and what support does about it. A queue profile's `## Bug lifecycle` table replaces this one; the pulse and the raise playbook read whichever applies. For a GitHub card the state is a label, or how the card was closed. A task has only its status, so two rows apply to it: `done` is closed as completed and `cancelled` is closed as not planned.

| State | Means | Support's part |
|---|---|---|
| `triage` | Raised, not looked at yet | Nothing |
| `needs info` | Development asked the user something, on the card | Draft the card's question as a reply to the ticket; once the user answers, offer to add the answer to the card |
| `accepted` | A real bug that will be fixed, or work the team will do | Nothing |
| `in progress` | The fix or change is being written | Nothing |
| closed as completed | Done, in the release named by its milestone | Once that release is out (the current version in the profile's `## Context`, or ask the operator), draft an "it's fixed" (or "it's out") reply for every ticket on the card |
| closed as not planned | Not a bug, or not doing it; the reason is on the card | Draft a reply that explains the decision |

New cards are raised in the first state (`triage`). A profile table keeps the same three columns, so any queue can rename a state, add one, or give support a different part.
