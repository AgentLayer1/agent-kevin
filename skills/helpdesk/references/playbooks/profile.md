# Profile — write or fix a queue profile (`/helpdesk profile [slug]`)

A queue profile is the operator's own file at `projects/<slug>/helpdesk.md`. Its frontmatter is read by code (this skill and sync's cadence check), so it stays flat; its body is rules for the model, in the operator's words.

## Write one

1. **Which project.** The tickets belong to one project in the home; `projects/<slug>/` must exist (if not, offer the project skill first). One profile per project.
2. **Which helpdesk.** Ask only when more than one is configured.
3. **Which statuses count as open.** SupportCandy: list them with `helpdesk_lookups` (`kind: statuses`). Pylon: `new`, `waiting_on_you`, `waiting_on_customer`, `on_hold`, `closed`, plus any custom slugs. The operator picks the ones the pulse keeps.
4. **How often.** `daily`, `weekly` or `monthly` makes sync nudge a pulse when none ran in that period; no cadence means never.
5. **The rules.** Ask for one to three triage rules, how a real bug gets filed, and the tone. Write their words, not a paraphrase; empty sections stay with their prompt line.
6. Write the file, then show it.

```markdown
---
helpdesk: supportcandy
statuses: [Open, Awaiting agent reply]
cadence: weekly
---

## Triage

- <a kind of ticket> → <what to do with it>

## Filing bugs

<when a ticket becomes a task, in which project, and what it must carry>

## Tone

<how replies sound>
```

Drop the `helpdesk` line when only one helpdesk is configured, and `cadence` when the operator wants no nudge.

## Fix one

Sync's nudge `Fix the helpdesk profile: <file>: <problem>` names what failed. Read the file, fix only the frontmatter key it names (`statuses` must be a list of names, `helpdesk` and `cadence` one of the allowed values, every value flat), and leave the body alone.
