---
name: roadmap
description: >
  Build or update a strategic roadmap as a polished, self-contained HTML surface — timeline lanes
  over a directional rail, milestone cards, outcome bands, dark/light themes. Use whenever the user
  wants a roadmap, a plan-on-a-page, a north star, a quarterly/half/yearly plan they can look at, or
  wants an existing roadmap.html updated, even if they never say "roadmap". Wizard-style: interviews
  for the frame, mines the task board / project READMEs / git history for milestones, then renders
  from the house template.
allowed-tools: AskUserQuestion, Read, Write, Edit, Glob, Grep, Bash, Skill(agent-kevin:goals), mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_get, mcp__plugin_agent-kevin_kevin__browser_screenshot, mcp__plugin_agent-kevin_kevin__run_upgrade
---

# Roadmap

Turn goals, tasks, and history into a roadmap surface worth staring at: a single self-contained HTML file where every phase or lane renders from one JSON data block inline in the page (`<script type="application/json" id="roadmap-data">`), which the renderer parses into `ROADMAP`. Focus pages read the same block to see what the roadmap says is in flight, so its dates and statuses are load-bearing. The deliverable is a living document — built once, then edited surgically as reality moves.

Three phases: **interview → harvest → render**. Don't skip the interview (a roadmap with the wrong frame is a rewrite, not an edit) and don't render before harvesting (a roadmap of invented milestones with guessed statuses is worse than none).

## Phase 0 · Context (no questions yet)

Figure out what already exists so the wizard asks only what's genuinely open:

1. **Update or create?** Glob for existing roadmaps: `<HOME>/roadmap.html` (the north star), `projects/*/roadmap.html` (a project's own), and anything the user pointed at. If the request targets an existing file, this is an **update** — skip to Iterating below; never regenerate a roadmap that already exists.
2. Identify the subject: the whole life/company (multi-lane), one project, or a code repo. Read the matching sources: the cross-project task dashboard and yearly goals (`projects/TASKS.md`), the project README + tasks, or the repo's docs. For the north star, also read `knowledge/concepts/roadmap-draft.md` when it exists: init writes the goals the operator gave during setup there as a `| When | Milestone |` table, and so does a seed bundle.
3. Note today's date and any hard external deadlines already on record (filings, events, seasons) — these become finish-line tags.
4. **North star only: yearly goals come first.** When the `## Yearly Goals` block in `projects/TASKS.md` is missing, still the placeholder, or planned in an earlier year, run the goals skill's year playbook before this wizard, through the Skill tool (`agent-kevin:goals` with `year`); its quarters become this build's goals source.

## Phase 1 · Wizard interview

Two rounds of `AskUserQuestion`, max 4 questions each. Derive options from context instead of open blanks (offer the horizons you found in their goals, not "when?").

**The wizard is skippable.** If the user already described the roadmap (a brain-dump, an existing planning doc, a goals block), extract everything from that first and ask only about gaps. Round 1 carries an explicit escape hatch ("I'll just tell you" / "use my notes as the base"); when taken, parse the dump and go straight to the final screen. A roadmap draft counts as that description: derive the horizons and lanes from its rows and offer them as the recommended options, so Round 1 confirms the frame instead of asking for it.

**Round 1: the frame**
- **North star** (HOME-root build only): the one line every lane ladders up to, the destination rather than this year's theme. Take it from the `## Yearly Goals` header when it carries one; otherwise ask, proposing one from the yearly theme, the roadmap draft and the project READMEs. It labels the `north` band (always on here) and the lede, and replaces the **Where it lives** question.
- **Shape**: multi-lane north star (parallel bets, each with its own finish line) vs phased project roadmap (shipped history → planned quarters → long-term horizon). Recommend the one the context implies. See "Two shapes, one system" in `references/DESIGN.md`.
- **Horizons**: offer concrete finish lines from their goals/deadlines (end of year, a launch, a season, an event) plus "you propose the cut". Multi-lane roadmaps can carry two horizons.
- **Lanes/phases**: propose the set you inferred (from goal buckets or project epics) and let them prune or add. 3–5 lanes or 2–4 phases is the sweet spot.
- **Where it lives**: the convention is `roadmap.html` at the root of whatever it covers — `<HOME>/roadmap.html` for the personal/company north star, `projects/<slug>/roadmap.html` for a project, the repo's docs dir for a client codebase. Both HOME-root and project roadmaps are auto-discovered by the dashboard and read by focus pages at those exact paths, so don't invent a nested location. Offer the inferred path as the recommended option.

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
- **Roadmap draft**: each `| When | Milestone |` row becomes a `planned` milestone in the period its When names.
- **The user's own words**: anything they dumped in the interview is first-class source material.

Every period gets a `start` (and an `end` when it spans more than one day, week or month) from a real date the operator gave or confirmed: `2026-10-05`, `2026-W41` or `2026-10`. An undated period still renders, but focus pages can only see its `progress` items. Name the task ids a milestone covers in its item text (`Webhook receiver (ac-012)`): that link is how a focus page shows which tasks move a milestone forward.

Rules: a `done` status needs evidence from this session (task frontmatter, git, or the user's word) — when unsure, downgrade to `planned` or ask. Milestone items are arc-level (≤ ~60 chars); detail stays on the task board. Route the two overflow streams per DESIGN.md's "overflow pair": harvested work that doesn't earn a period parks in the long-term horizon (the inbox for the next planning cycle), and shipped work that was never planned becomes unplanned wins, not a retrofitted milestone. When the ordering of milestones is deliberate, capture per-milestone `unlocks` lines — what shipping each one buys — so the sequence reads as a flywheel, not a list.

## Phase 3 · Render

1. Read `references/DESIGN.md`, then `references/template.html`; glance at `references/example.png` to see a full-featured build. The template is the aesthetic contract; compose its sections, don't redesign it.
2. Copy the template's markup and renderers wholesale; replace the palette tokens (both themes), the header copy, the footer, the localStorage key (`<slug>-roadmap-theme`), and the contents of the `roadmap-data` block. The block is strict JSON: quoted keys, no comments, no trailing commas, and every `</` inside a string written `<\/` so it can't end the script. Sections render in object order — arrange them to tell the story (north band → lanes → meta, or history → future → horizon).
3. Write to the path settled in Round 1. Creating alongside an existing roadmap for the same subject means a new versioned name, never an overwrite.
4. **Data check**: `bun "$PLUGIN_ROOT/skills/roadmap/scripts/check.ts" <path>` (`$PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`, or this skill's base directory two levels up under Codex). It fails on JSON that won't parse, a raw `</`, an unknown status, or a date that doesn't parse or ends before it starts. It warns on undated milestones and on items focus pages would skip. Fix every error before the render check; an undated "ongoing" strip is fine.
5. **Render check**: screenshot the `file://` URL (`browser_screenshot`) and confirm every section renders — the page fails soft, so a data-object typo silently renders header-only. Fix before handoff. In full-page shots, below-fold cards sit at opacity 0 mid entry-animation and read as blank sections — pass `css: ".ms, .bcard { animation: none !important; opacity: 1 !important; transform: none !important; }"` before concluding a section is broken.
6. Link the roadmap from the subject's README (or memory index for a HOME-root north star), then give a 3–5 line summary: shapes, horizons, and any status you marked `planned` because it couldn't be verified. Include the `file://` path; only launch `open` if Bash runs unsandboxed.

   For a project roadmap that means one line in the README's `## Structure` list, alongside `tasks/`: "`roadmap.html` — the living project roadmap; edit its `roadmap-data` block, reload". The dashboard picks the file up on its own (a 🧭 row on the project's card); no config, no manual registration.

   A north star asked in Round 1 also goes into the `## Yearly Goals` header line in `projects/TASKS.md` (`· north star: <one line>`); edit only that line.

   When the build started from `roadmap-draft.md`, add one line under the draft's title: "Rendered into `roadmap.html` on <date>; edit that file from now on." Keep the draft, since it records what the operator first said.

## Iterating

An existing roadmap is a living document — updates are **surgical edits to the `roadmap-data` block**, never a regeneration. "Mark M3 shipped", "add a lane", "push the launch a month" are targeted `Edit` calls on data entries; the markup and renderers don't change. Regeneration loses hand-tuned copy and the user's mental map of the page. A changed north star (the `north` band's label) goes into the `## Yearly Goals` header line too.

When statuses are being refreshed wholesale (a planning-cadence pass), re-harvest from ground truth first — task frontmatter and git, not memory — then edit the deltas. Run the data check after every edit, and the render check after any edit that touched the data's structure.

**Dating an undated roadmap.** A roadmap moved to JSON by the 0.5.3 upgrade has free-text period names and no dates. When the operator asks to date it, or a focus page says a roadmap is undated, propose a `start`/`end` for each period from its name and its section's `range`, show them as one table, and write only what the operator confirms. A period whose dates you can't infer with confidence goes into the question, never a guess.

**A roadmap still on a `const ROADMAP = {` literal** was either created before 0.5.3 or left untouched by its migration (the report says why: a render that changed between runs, a value JSON can't hold). Never convert it by hand. Fix what the reason names, if anything, then call `run_upgrade` with `{ version: "0.5.3" }`: it converts every such page in the home, replacing each only after its render matches, and skips the rest.

A structural rethink (different shape, different horizons) is a new build: re-run the wizard seeded with the current file's data.

## Failure modes to avoid

- **Skipping the wizard** because the request seems complete. "Make me a roadmap for the app" still leaves shape, horizon, and palette open; one round minimum.
- **Inflated statuses.** One ⏳ that should be 📋 makes the reader distrust every ✅. Ground truth or downgrade.
- **Task-list altitude.** Copying task titles verbatim into milestone items produces a cramped task board with worse ergonomics. Summarize the arc; the board keeps the detail.
- **Silent render failures.** The Write succeeding is not the page working. Run the data check and screenshot every time, including after edits.
- **Redesigning the template.** New needs compose existing sections. If the design system genuinely can't express something, extend the template file deliberately and note it for the next roadmap.
- **Overwriting a living roadmap.** The existing file may carry hand edits the sources don't know about. Update mode edits data in place; a rebuild needs the user's explicit go.
