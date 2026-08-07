---
name: roadmap
description: Build or update a strategic roadmap as a polished, self-contained HTML surface — timeline lanes over a directional rail, milestone cards, outcome bands, dark/light themes. Use whenever the user wants a roadmap, a plan-on-a-page, a north star, a quarterly/half/yearly plan they can look at, or wants an existing roadmap.html updated, even if they never say "roadmap". Wizard-style: interviews for the frame, mines the task board / project READMEs / git history for milestones, then renders from the house template.
allowed-tools: AskUserQuestion, Read, Write, Edit, Glob, Grep, Bash, mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_get, mcp__plugin_agent-kevin_kevin__browser_screenshot
---

# Roadmap

Turn goals, tasks, and history into a roadmap surface worth staring at: a single self-contained HTML file where every phase or lane renders from one `ROADMAP` data object. The deliverable is a living document — built once, then edited surgically as reality moves.

Three phases: **interview → harvest → render**. Don't skip the interview (a roadmap with the wrong frame is a rewrite, not an edit) and don't render before harvesting (a roadmap of invented milestones with guessed statuses is worse than none).

## Phase 0 · Context (no questions yet)

Figure out what already exists so the wizard asks only what's genuinely open:

1. **Update or create?** Glob for existing roadmaps: `<HOME>/roadmap.html`, `projects/*/references/roadmap.html`, and anything the user pointed at. If the request targets an existing file, this is an **update** — skip to Iterating below; never regenerate a roadmap that already exists.
2. Identify the subject: the whole life/company (multi-lane), one project, or a code repo. Read the matching sources: the cross-project task dashboard and yearly goals (`projects/TASKS.md`), the project README + tasks, or the repo's docs.
3. Note today's date and any hard external deadlines already on record (filings, events, seasons) — these become finish-line tags.

## Phase 1 · Wizard interview

Two rounds of `AskUserQuestion`, max 4 questions each. Derive options from context instead of open blanks (offer the horizons you found in their goals, not "when?").

**The wizard is skippable.** If the user already described the roadmap (a brain-dump, an existing planning doc, a goals block), extract everything from that first and ask only about gaps. Round 1 carries an explicit escape hatch ("I'll just tell you" / "use my notes as the base"); when taken, parse the dump and go straight to the final screen.

**Round 1: the frame**
- **Shape**: multi-lane north star (parallel bets, each with its own finish line) vs phased project roadmap (shipped history → planned quarters → long-term horizon). Recommend the one the context implies. See "Two shapes, one system" in `references/DESIGN.md`.
- **Horizons**: offer concrete finish lines from their goals/deadlines (end of year, a launch, a season, an event) plus "you propose the cut". Multi-lane roadmaps can carry two horizons.
- **Lanes/phases**: propose the set you inferred (from goal buckets or project epics) and let them prune or add. 3–5 lanes or 2–4 phases is the sweet spot.
- **Where it lives**: HOME root for a personal/company north star, `projects/<slug>/references/` for a project, the repo's docs dir for a client codebase. Offer the inferred path as the recommended option.

**Round 2: texture (build from Round 1 answers)**
- **Accent scheme**: offer the named presets — purple (template default; product/engineering), green (fresh/operational), gold (personal/north-star) — and let Other take a typed hue or brand color. Use option descriptions to convey the mood; DESIGN.md has the token sets and per-preset dark tints.
- **History backfill** (phased shape only): should shipped work appear as a `done` phase? For repos, offer to backfill it from git history — it's the most credible part of the page.
- **Optional sections** (multiSelect): north-star band up top, meta-projects strip, long-term horizon, unplanned-wins band.
- **Cadence framing**: monthly periods vs quarters vs custom blocks — offer what the horizon implies (a 5-month runway reads best monthly; 18 months reads best quarterly).

**Final screen (always, even when the rounds were skipped):** one last `AskUserQuestion` — "Anything else this roadmap should capture before I build it?" with a "Nothing to add, go ahead" default. Whatever they type via Other (a lane you missed, a constraint, a deadline) gets woven in. Never start Phase 2 without offering it.

## Phase 2 · Harvest

Fill the frame with real content. Milestones come from sources, not imagination:

- **Task board**: `task_query` the relevant project(s); open/active tasks cluster into planned milestones, closed ones into shipped items. Statuses map from frontmatter: `done`→`done`, `active`→`progress`, `open`/`blocked`→`planned`.
- **Git history** (repo roadmaps): `git log --oneline` since the epoch the user named; cluster commits into monthly milestone themes. This is how a credible shipped phase gets backfilled.
- **Goals blocks**: yearly/quarterly goals become outcome tiles and finish-line checks (the last period of a lane often is "the quarter check").
- **The user's own words**: anything they dumped in the interview is first-class source material.

Rules: a `done` status needs evidence from this session (task frontmatter, git, or the user's word) — when unsure, downgrade to `planned` or ask. Milestone items are arc-level (≤ ~60 chars); detail stays on the task board. Route the two overflow streams per DESIGN.md's "overflow pair": harvested work that doesn't earn a period parks in the long-term horizon (the inbox for the next planning cycle), and shipped work that was never planned becomes unplanned wins, not a retrofitted milestone. When the ordering of milestones is deliberate, capture per-milestone `unlocks` lines — what shipping each one buys — so the sequence reads as a flywheel, not a list.

## Phase 3 · Render

1. Read `references/DESIGN.md`, then `references/template.html`; glance at `references/example.png` to see a full-featured build. The template is the aesthetic contract; compose its sections, don't redesign it.
2. Copy the template's markup and renderers wholesale; replace the palette tokens (both themes), the header copy, the footer, the localStorage key (`<slug>-roadmap-theme`), and the `ROADMAP` data object. Sections render in object order — arrange them to tell the story (north band → lanes → meta, or history → future → horizon).
3. Write to the path settled in Round 1. Creating alongside an existing roadmap for the same subject means a new versioned name, never an overwrite.
4. **Render check**: screenshot the `file://` URL (`browser_screenshot`) and confirm every section renders — the page fails soft, so a data-object typo silently renders header-only. Fix before handoff. In full-page shots, below-fold cards sit at opacity 0 mid entry-animation and read as blank sections — pass `css: ".ms, .bcard { animation: none !important; opacity: 1 !important; transform: none !important; }"` before concluding a section is broken.
5. Link the roadmap from the subject's README (or memory index for a HOME-root north star), then give a 3–5 line summary: shapes, horizons, and any status you marked `planned` because it couldn't be verified. Include the `file://` path; only launch `open` if Bash runs unsandboxed.

## Iterating

An existing roadmap is a living document — updates are **surgical edits to the `ROADMAP` object**, never a regeneration. "Mark M3 shipped", "add a lane", "push the launch a month" are targeted `Edit` calls on data entries; the markup and renderers don't change. Regeneration loses hand-tuned copy and the user's mental map of the page.

When statuses are being refreshed wholesale (a planning-cadence pass), re-harvest from ground truth first — task frontmatter and git, not memory — then edit the deltas. Re-run the render check after any edit that touched the object's structure.

A structural rethink (different shape, different horizons) is a new build: re-run the wizard seeded with the current file's data.

## Failure modes to avoid

- **Skipping the wizard** because the request seems complete. "Make me a roadmap for the app" still leaves shape, horizon, and palette open; one round minimum.
- **Inflated statuses.** One ⏳ that should be 📋 makes the reader distrust every ✅. Ground truth or downgrade.
- **Task-list altitude.** Copying task titles verbatim into milestone items produces a cramped task board with worse ergonomics. Summarize the arc; the board keeps the detail.
- **Silent render failures.** The Write succeeding is not the page working. Screenshot every time, including after edits.
- **Redesigning the template.** New needs compose existing sections. If the design system genuinely can't express something, extend the template file deliberately and note it for the next roadmap.
- **Overwriting a living roadmap.** The existing file may carry hand edits the sources don't know about. Update mode edits data in place; a rebuild needs the user's explicit go.
