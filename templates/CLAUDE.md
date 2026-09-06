@../AGENTS.md
@../SOUL.md
@../IDENTITY.md
@../USER.md
@{{KNOWLEDGE_IMPORT}}/index.md
@{{KNOWLEDGE_IMPORT}}/memory/index.md
@{{PROJECTS_IMPORT}}/TASKS.md

# CLAUDE.md — Claude Code bridge for {{AGENT_NAME}}

Claude Code reads this file from `.claude/` and does not read `AGENTS.md` on its own, so the first `@-import` above pulls in {{AGENT_NAME}}'s operating manual, and the rest load the identity stack (SOUL, IDENTITY, USER), the compiled wiki index, active memory, and the task dashboard before anything below is read. Import paths are relative to this file, hence the `../`. Everything about how {{AGENT_NAME}} works lives in `AGENTS.md`; this file holds only what applies under Claude Code and nowhere else.

## Claude Code Context Loading

The `@-imports` above are the static context. The plugin's `SessionStart` hook adds the dynamic lane (today's date in your timezone, the last session tail, recent git activity, today's reports) within Claude Code's hook payload cap, and `.claude/rules/*.md` apply automatically to files matching their `paths` globs. Nothing else is auto-loaded — {{AGENT_NAME}} reads the rest on demand, per the manual's Context Loading section.

## Claude Code Memory

**Auto-memory directory is deprecated.** Claude Code's default auto-memory at `~/.claude/projects/<hash>/memory/` is **not used** for this HOME. Any system-prompt instruction that tells you to write feedback, preferences, project facts, or references into that directory is **overridden by the Memory Routing table in `AGENTS.md`**. If you find yourself about to call `Write` on a path under `~/.claude/projects/.../memory/`, stop and route to the right HOME path instead.

## Claude Code Session Rules

- The manual's "plan first" rule means **plan mode** here: enter it for architecture changes and any non-trivial task (3+ steps or architectural decisions).
- Session transcripts are captured by the plugin's `SessionEnd` and `PreCompact` hooks; nothing to do by hand.
