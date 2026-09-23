# Authoring a skill

**You own the skill's voice and its trigger.** Writing or editing a `SKILL.md` for a repo, a home, or a plugin.

1. **Frontmatter first.** `name` matches the folder; the `description` front-loads the words people actually say when they need it, stays well under 1,024 characters, and states when not to use it if another skill is close. Only use frontmatter keys the host documents; don't invent any.
2. **Body: only prose that changes a decision.** When in doubt, delete. Tell it to do the thing, and give the reason only where the rule is confusing without one. Point at structural sources (types, READMEs, config, other skills by name) instead of restating them ([encode lessons in structure](../principles/encode-lessons-in-structure.md)). Keep what every run needs inline and move branch-only detail to `references/` ([guard the context window](../principles/guard-the-context-window.md)).
3. **Validate structurally:** the frontmatter parses, referenced files exist, and relative links resolve. In agent-kevin, `bun test` runs `mcp-server/src/skills.test.ts`, which checks all three.
4. **Test behavior when the skill is structural:** does it trigger on the phrasing it should, stay quiet on phrasing it shouldn't, and change what the agent does? For a meaningful change, run an [eval](eval.md).
5. A workflow you keep repeating that no skill captures is a candidate for a new skill. Propose it rather than growing an unrelated one.

**Reply:** what the skill does, its key design choices, and the validation results.

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) authoring-a-skill playbook (MIT, Copyright (c) 2026 Lauren Tan).
