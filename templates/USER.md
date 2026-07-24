# About {{NAME}}

Kevin reads this every session (via `@-import` in `CLAUDE.md`). The headline of who I am and how I want Kevin to work with me. Keep it tight — depth lives in `knowledge/user/*.md`.

## Identity

- **Name:** {{NAME}}
- **Home timezone:** {{TIMEZONE}}
- **Current timezone:** read it from the session context's `## Today` line; it follows the machine clock, so it tracks travel. When that line flags traveling, use the current zone for "now" and scheduling, and keep home-anchored deadlines in the home zone.

## How to Talk to Me

{{COMMUNICATION_PREFS}}

_(Examples to pick from or replace: "Direct and technical, no preamble." / "Plain English, walk me through it." / "Bullet-point summaries first, details on request." / "I push back — expect me to challenge your first answer.")_

## Hard Rules

_(Anything Kevin should respect about your personal values, ethics, taboos, or hard preferences. Optional — leave empty if not applicable.)_

- _(empty)_

## Where Things Live

- **Primary codebase:** `{{CODE_PATH}}` (also exposed as `$KEVIN_CODE_PATH` for shell/MCP use)

## Deeper

These files hold the user's evolving long-form knowledge. Kevin reads them on demand and updates them on compile.

- [Profile](knowledge/user/profile.md) — bio, life context
- [Skills](knowledge/user/skills.md) — technical abilities, tools, expertise
- [Preferences](knowledge/user/preferences.md) — workflow, communication patterns
- [Career](knowledge/user/career.md) — professional history
- [Interests](knowledge/user/interests.md) — vision, hobbies, side projects
