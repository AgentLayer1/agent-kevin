# Verification skill

**You own a scripted way to prove the app works.** Every serious repo needs one: launch the app, exercise a feature the way a user does, and capture evidence. This playbook generates it as a repo-local skill, `verify-<app>`, in the repo's skills folder (`.claude/skills/` for Claude Code). Write it for the next agent, who reads it cold and mid-task.

## Generate

1. **Interview the repo, not the operator.** Answer from the code and ask only what you can't observe:
   - **Surface:** what a user touches (web UI, CLI or TUI, desktop app, API, mobile app, library). Pick the primary one and note the rest.
   - **Run:** the repo's own documented dev command, plus ports, env vars, seed data, and auth.
   - **Drive:** existing harnesses first (Playwright or Cypress specs, expect scripts, curl-able endpoints). Otherwise the browser tools for web, a PTY or tmux session for CLIs, plain HTTP for services, and the Xcode loop for Apple apps.
   - **Observe:** screenshots, terminal transcripts, response bodies, logs, exit codes, database state.
   - **Isolate:** can two instances run side by side? If not, say so; refusing to double-drive a shared instance beats corrupting the operator's session.

   If the checkout doesn't build or start, fix that or report it precisely before generating.
2. **Write `verify-<app>/SKILL.md`,** with frontmatter (a `name` and a `description` naming the app and surface) and these sections, all grounded in what you found, no placeholders:
   - **Launch:** the exact start command, how to tell it's ready, and teardown.
   - **Doctor:** one read-only check that the instance is worth driving (up, right build, port owned by us, auth valid).
   - **Drive:** the recipe with this repo's real selectors and commands. Prefer stable handles (ARIA labels, data attributes, routes) over coordinates.
   - **Evidence:** what to capture and where. Exercise the real user path, not test-only endpoints. Capture the action and the resulting state. Verify side effects (files, rows, messages) alongside what's visible. Check what a dry-run mode actually skips by observing it.
   - **Cleanup:** kill only what you started, never by process name, and keep the evidence.
   - **Helpers:** any script it ships is executable and its invocation is shown.
3. **Seed a feature map:** `features/README.md` plus one file per top user-facing feature (3 to 5 to start), each covering sub-features, how to reach it as a user, how to drive it, and gotchas.
4. **Prove it before handing it over.** Run its own instructions end to end once: launch, doctor, drive one mapped feature, capture evidence, clean up, and confirm the evidence survived cleanup. A generated skill that was never run is a draft.

## Maintain

When the app changes, the map rots. The maintenance pass edits only the verification skill's own folder, never product code.

1. Fix the map's index (missing, extra, or dead entries).
2. Run one read-only subagent per feature file: each explains the feature from source, flags likely drift with citations, and returns one live recipe.
3. Drive every feature live, serially, health-checking the instance before the first drive and after any failure.
4. Triage what you find:
   - Wrong descriptions are doc drift: fix them.
   - Behavior the harness can't drive is a harness gap: fix it.
   - App behavior that's actually broken is a product regression: report it, and never paper over it in the docs.
5. End in exactly one outcome: **clean** (nothing to change), **changed** (one set of proven corrections), or **blocked** (say what blocked it).

---

Adapted from [pstack](https://github.com/cursor/plugins/tree/main/pstack) `create-verification-skill` and `maintain-verification-skill` skills (MIT, Copyright (c) 2026 Lauren Tan).
