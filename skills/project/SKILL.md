---
name: project
description: >
  Start or retire a project. Create stands up projects/<slug>/ with a README and a tasks folder (the
  2-letter task prefix derives from the slug, no config edit). Archive retires a finished or
  cancelled project: moves it to archive/, strips references from active docs and schedules, adds a
  final-thoughts banner, logs it, and recompiles the project index. Triggers on "create a new
  project called X", "start a project for Y", a new multi-artefact initiative worth its own folder,
  "archive <project>", "retire <project>", a project declared done or cancelled, or /project.
---

# Project

A project is a folder with a README and its tasks. Creating one puts it in the knowledge index, the task tools and the flywheel; archiving one keeps it for history and takes it off every active surface.

## Help

`/project help` (or "what can project do?") asks for the menu: reply with [help](references/help.md) exactly as written and stop.

## Start

Match the ask to a playbook below, open it, and follow its steps. The word after the playbook is the project's name or slug (`/project create acme-site`, `/project archive acme-site`).

## Playbooks

| Ask | Playbook |
|---|---|
| "create a new project called X", "start a project for Y", `/project create <name>` | [create](references/playbooks/create.md) |
| "archive <project>", "retire <project>", a project declared done or cancelled, `/project archive <slug>` | [archive](references/playbooks/archive.md) |

## Every time

- **One-off work isn't a project.** A single task goes in an existing project's `tasks/`, and a quick note goes to `<HOME>/knowledge/raw/inbox/`.
- **Nothing moves without a yes.** Create confirms the name and slug, and archive confirms the project and the move before touching anything.
- **Paused isn't finished.** A blocked or paused project gets `blocked_by` on its tasks, never an archive.

## Reply

Each playbook names its confirmation, ending with the project's README path.
