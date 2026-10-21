# Default bug lifecycle

What each state of a filed bug means and what support does about it. A queue profile's `## Bug lifecycle` table replaces this one; the pulse and the file bug playbook read whichever applies. For a GitHub card the state is a label, or how the card was closed; for a task it is the task's status.

| State | Means | Support's part |
|---|---|---|
| `triage` | Filed, not looked at yet | Nothing |
| `needs info` | Development asked the user something, on the card | Draft the card's question as a reply to the ticket; once the user answers, add the answer to the card |
| `accepted` | A real bug that will be fixed | Nothing |
| `in progress` | The fix is being written | Nothing |
| closed as completed | Fixed, in the release named by its milestone | Once that release is out, draft an "it's fixed" reply for every ticket on the card |
| closed as not planned | Not a bug, or not changing; the reason is on the card | Draft a reply that explains the decision |

New cards are filed in the first state (`triage`). A profile table keeps the same three columns, so any queue can rename a state, add one, or give support a different part.
