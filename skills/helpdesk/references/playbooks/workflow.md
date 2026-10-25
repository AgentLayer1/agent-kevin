# Workflow — a routine the queue profile defines (`/helpdesk <name> [slug]`)

A profile's `## Workflow: <name>` section is a routine of that queue's own: a weekly digest for the team, a sweep of App Store reviews, a monthly look at the most-asked features. Its steps are written there, in the operator's words.

## Steps

1. Read the section, plus the profile's `## Triage`, `## Raising`, `## Tone` and `## Context`, and the org rules. Org boundaries still hold: a workflow can't loosen one.
2. Follow its steps with the helpdesk tools, `helpdesk` and `connection` from the profile. A step that needs a write (a note, an assignment, a card, a task) still waits for the operator's yes, unless the section says its notes and assignments go ahead without asking: then those two run unasked and the output lists each ticket with what was written. Cards, tasks and comments always wait.
3. **Save** when the routine is in the profile's `schedule`, since its report is sync's watermark: `report_write` with category `helpdesk`, slug `<name>-<slug>`, and the routine's output as the body. Save only a complete run: one cut short by an error says so in chat and saves nothing, so sync nudges it again. An unscheduled routine saves only when its steps say to.

## Output

What the section's steps say to produce, then the report's path when one was saved.
