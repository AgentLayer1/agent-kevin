---
name: project
description: >
  Start, retire, or hand off project work. Create stands up projects/<slug>/ with a README and a
  tasks folder. Archive moves a finished or cancelled project to archive/, strips active
  references, adds a final-thoughts banner, and recompiles the index. Handoff opens a GitHub issue
  on the project's repo for a task and links the task to it. Triggers on "create a new project
  called X", "start a project for Y", a new multi-artefact initiative, "archive <project>",
  "retire <project>", a project declared done or cancelled, "hand off <task>", "push this task to
  GitHub", or /project.
---

# Project

> **Plugin root:** `${CLAUDE_PLUGIN_ROOT}`. Claude Code writes the real path there when it loads this file; Codex leaves it unfilled, and there the plugin root is this skill's base directory two levels up (the `<skill>` block's `<path>`). Playbook commands write `<plugin root>`: put this path in its place before running one, since no shell fills it in.

A project is a folder with a README and its tasks. Creating one puts it in the knowledge index, the task tools and the flywheel; archiving one keeps it for history and takes it off every active surface.

## Help

`/project help` (or "what can project do?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Start

Match the ask to a playbook below, open it, and follow its steps. The word after the playbook is the project's name or slug (`/project create acme-site`, `/project archive acme-site`). A bare `/project` replies with [help](references/help.md) and stops.

## Playbooks

| Ask | Playbook |
|---|---|
| "create a new project called X", "start a project for Y", `/project create <name>` | [create](references/playbooks/create.md) |
| "archive <project>", "retire <project>", a project declared done or cancelled, `/project archive <slug>` | [archive](references/playbooks/archive.md) |
| "hand off <task>", "push this task to GitHub", "share this task with the team", `/project handoff <id>` | [handoff](references/playbooks/handoff.md) |

## Every time

- **One-off work isn't a project.** A single task goes in an existing project's `tasks/`, and a quick note goes to `<HOME>/knowledge/raw/inbox/`.
- **Nothing moves without a yes.** Create confirms the name and slug, archive confirms the project and the move, and handoff shows the issue's draft before touching anything.
- **Paused isn't finished.** A blocked or paused project gets `blocked_by` on its tasks, never an archive.

## Reply

Each playbook names its confirmation, ending with the project's README path.
