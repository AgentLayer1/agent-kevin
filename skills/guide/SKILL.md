---
name: guide
description: >
  Write a guide someone else can follow as a polished HTML page: a setup walkthrough, onboarding, or
  how a workflow runs end to end and who does what. Triggers on "write a guide for", "make a setup
  guide", "onboarding guide", "walk <person> through", "something I can give to <person>", or /guide.
allowed-tools: AskUserQuestion, Read, Write, Edit, Glob, Grep, Bash, mcp__plugin_agent-kevin_kevin__browser_screenshot, mcp__plugin_agent-kevin_kevin__browser_pdf
---

# Guide

Turn something the operator knows into a page someone else can follow on their own. The deliverable is one self-contained HTML file in the operator's home, built from `references/template.html` and handed over as a `file://` path. Three phases: **interview → gather → render**, then the check.

## Phase 1 · Interview

One round of `AskUserQuestion`, up to four questions, with options derived from the conversation. Skip any question the request already answers; if it answers all of them, go straight to Phase 2.

- **Reader:** who it's for and how technical they are. This sets the vocabulary for the whole page.
- **Goal:** what the reader can do after reading (set up a machine, run a weekly routine, understand a handoff).
- **Voice:** the operator speaking in the first person ("I'll set this up with you"), or neutral.
- **Shape:** the sections you propose from the material (setup, who does what, the flow, a worked example, the routine, rules, questions). Let them prune.

## Phase 2 · Gather

Collect every specific the page will state: commands, URLs, menu paths, settings, names of the tools the reader will open, who does which step. Each comes from this session's reading (the project README, task files, a vendor's docs page) or from the operator. What isn't built or decided yet is recorded as such, so the page can label it honestly. A command that installs software links the vendor's own page rather than copying its install script.

## Phase 3 · Render

1. Read `references/DESIGN.md`, then `references/template.html`. Copy the template whole and replace its content: the `<title>`, the brand line, the hero, the sections, the footer. Keep the theme block, the sidebar, the script and the print styles exactly as they are.
2. Compose only the modules this guide needs, from DESIGN.md's catalog. Every section opens with a one-line `.phase-why`, and the actor colours stay the same across modules.
3. Write it to `<HOME>/reports/guides/<slug>.html` (a short kebab-case slug of the guide's subject). If that file exists, this is an update: see Iterating. When the guide belongs to a project, link it from that project's README.
4. Check it: `browser_screenshot` with `fullPage: true` on the file, and read the image. Look for broken layout, empty sections, a swimlane card in the wrong column, and text that overflows. Fix and re-check. For a guide the reader may print, also run `browser_pdf` and confirm the cards don't split across pages.
5. Hand over the `file://` path with a three-to-five line summary: who it's for, the sections, and anything the page labels as not ready yet.

## Iterating

The file is a living document. Changes ("add a section on X", "that step changed") are targeted `Edit` calls on the existing file, never a regeneration, so the reader's saved ticks and the verified wording survive. Saved ticks are keyed on the order of the steps, so insert new steps at the end of a list where order allows. Re-run the screenshot check after any change that adds or removes a module.

## Failure modes

- **Jargon the reader doesn't have.** A word the reader would have to look up gets renamed or explained in the same sentence.
- **Steps out of dependency order.** Every step uses only what an earlier step installed or created.
- **Presenting the future as live.** Anything not built yet carries a `.status.soon` chip or a plain "coming later".
- **Redesigning the template.** A new need composes existing modules. If the design system truly can't express something, extend the template deliberately and record it in DESIGN.md.
