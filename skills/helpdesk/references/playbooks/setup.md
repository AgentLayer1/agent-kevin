# Setup — set up or tune a project's support queue (`/helpdesk setup [slug]`)

Setting up a queue writes its profile, the operator's own file at `projects/<slug>/helpdesk.md`. Its frontmatter is read by code (this skill and sync's cadence check), so it stays flat. Its body is the queue's own workflow, rules and context, in the operator's words. Run again on a project that has one, setup tunes it.

## Access first

`helpdesk_connections` lists what the home can reach. When nothing is configured, or the project has no connection of its own and there is no default, the queue has nothing to read yet: run the `configure-skills` Helpdesk walk for this project through the Skill tool. The walk ends at a relaunch, because new keys load when the session starts; say so, and that `/helpdesk setup <slug>` picks up from here after it. A tool permission error means the same walk.

## The interview

Run it in rounds with `AskUserQuestion`, a few questions at a time. Each question shows the plugin's default, and "the default" is always an answer. Write the operator's words, not a paraphrase. A round they skip, or answer with "the default", leaves its section out, so the default applies.

1. **The queue.**
   - Which project the tickets belong to, unless the ask named it (`projects/<slug>/` must exist; if not, offer the project skill first). One profile per project.
   - Which connection: `helpdesk_connections` lists them. One named after this project's slug is the project's own, so offer it first; the default (the No project connection) needs no `connection` line.
   - Which statuses count as open: SupportCandy's from `helpdesk_lookups` (`kind: statuses`); Pylon's are `new`, `waiting_on_you`, `waiting_on_customer`, `on_hold` and `closed`, plus any custom slugs.
   - How often the pulse runs: daily, weekly, monthly or only when asked.
   - Whether the product ships on the App Store: its link or id becomes `appstore` (the digits after `id` in the link), and the pulse then reads its reviews too. Don't ask about storefronts; the reviews tool picks them. Write `storefronts` only when the operator names countries to pin.
2. **The pulse.** The default is the [pulse](pulse.md) playbook. Ask:
   - what needs a person first;
   - which streams to collapse into a count;
   - what else to check or report;
   - who reads it, and what the summary must say.

   Then ask whether this adds to the default or replaces it.
3. **Bugs.**
   - Where they go: nowhere, a task in a project here, or a card on a GitHub repo, and which labels it carries.
   - The lifecycle: show the [default table](../lifecycle.md) and ask what to rename, add or change about support's part.
   - What a card must carry and must never carry, and how duplicates are handled.
4. **Replies.**
   - Tone, language and sign-off.
   - Macros or canned replies to start from.
   - What is never promised.
   - Which topics a person writes themselves.
5. **Context.**
   - The product and its current versions.
   - Help docs and FAQ links.
   - Known issues.
   - The team and who does what.
   - Who to escalate to.
6. **More routines.** Any other recurring support job: a weekly digest, a review sweep, a monthly feature-request count. Each becomes a `## Workflow: <name>` section (a name of letters and digits, not one of the skill's own playbooks), and its steps are the operator's. Ask how often each runs, for `schedule`.

Write the file, show it, and confirm.

## The file

```markdown
---
helpdesk: supportcandy
connection: shop
statuses: [Open, Awaiting agent reply]
schedule: [pulse:daily, digest:weekly]
appstore: 1234567890
---

## Pulse

<what to add to the default pulse, or "Replaces the default." and the whole pulse>

## Triage

- <a kind of ticket> → <what to do with it>

## Bug lifecycle

<the whole default table from lifecycle.md with the operator's changes, since this table replaces it>

## Filing bugs

<where a bug goes (a task in a project here, or a card on <owner>/<repo>), its labels, what a card carries and never carries>

## Tone

<how replies sound, the language, the sign-off, what is never promised, what a person writes>

## Context

<the product and versions, help links, known issues, the team, escalation>

## Workflow: digest

1. <the routine's steps>
```

Drop `helpdesk` when only one kind is configured, `connection` for the default, `schedule` when the operator wants no nudges, `appstore` when the product isn't on the App Store, and any section they left to the default (a missing `## Bug lifecycle` means the default table).

## Tune one

Read the profile, show what it holds round by round, ask which parts to change, and run only those rounds. Edit those sections in place and leave the rest exactly as written.

## Fix one

Sync's nudge `Fix the helpdesk profile: <file>: <problem>` names what failed. Read the file and fix only the key it names:
- `statuses` must be a list of names.
- `helpdesk` must be one of the helpdesks.
- Every `schedule` entry must be `<routine>:<daily|weekly|monthly>`, where the routine is `pulse` or has its own `## Workflow:` section.
- `appstore` must be the app's numeric id; `storefronts`, when present, needs `appstore` and two-letter codes.

Leave the rest of the body alone.
