# Workflow — a routine the queue profile defines (`/helpdesk <name> [slug]`)

A profile's `## Workflow: <name>` section is a routine of that queue's own: a weekly digest for the team, a sweep of App Store reviews, a monthly look at the most-asked features. Its steps are written there, in the operator's words.

## Steps

1. Read the section, plus the profile's `## Context` and the org rules. Org boundaries still hold: a workflow can't loosen one.
2. Follow its steps with the helpdesk tools, `helpdesk` and `connection` from the profile. A step that needs a write (a note, a card, a task) still waits for the operator's yes.
3. **Save** when the routine is in the profile's `schedule`, since its report is sync's watermark: `report_write` with category `helpdesk`, slug `<name>-<slug>`, and the routine's output as the body. An unscheduled routine saves only when its steps say to.

## Output

What the section's steps say to produce, then the report's path when one was saved.
