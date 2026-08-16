# Roadmap Design System

`references/template.html` is a complete worked example (a fictitious Acme product roadmap). It is the **aesthetic contract**: a dark-first, single-file HTML surface where a `ROADMAP` data object at the bottom renders into timeline lanes, milestone cards, and outcome bands. Copy it, replace the data and the palette, compose the sections the roadmap needs. Don't redesign it from scratch, and don't hand-write section markup — everything below the header renders from the data object. `references/example.png` is a full-featured build with every section in play — look at it before composing to see how the pieces read together.

## What stays fixed

- **Data-driven.** One `ROADMAP` object is the single source of truth; sections render in object order via the `RENDERERS` dispatch. Editing the roadmap later means editing data, never markup. This is the whole maintenance model: "edit the data, reload, no build step."
- **The timeline track.** The workhorse section: period pills on a gradient directional rail with an arrowhead, milestone cards interwoven above and below, dotted connector stubs and gutter dividers. Each period holds a top card and an optional bottom card; either row can stack several cards (see Stacked rows below).
- **Milestone cards.** Mono chip (`M1`, `W3`…) + short title + status-emoji items. Statuses are exactly `done` / `progress` / `planned` (✅ / ⏳ / 📋), matched by the header legend.
- **Outcome bands.** Brand-tinted "what this earns" tiles (icon + label + one-line desc, optional `when`) close each timeline section; a `north` section can open the page with the same tiles as the document's finish lines.
- **Dark default + light toggle.** Both themes ship; the toggle persists via localStorage. The storage key is per-roadmap (`<slug>-roadmap-theme`) so two roadmaps don't fight over one preference. The light theme is always the **cool-paper treatment**: near-white cool background, pure-white cards, brand accents darkened for contrast (bright goes *darker* than brand in light mode), `--brand-deep` flipped to a pale wash.
- **Typography.** Bricolage Grotesque for display, IBM Plex Sans for body, IBM Plex Mono for chips, pills, and labels. Google Fonts is the only external dependency.
- **Texture.** Dotted-grid backdrop, radial brand glow, soft-rise entry animation (disabled under `prefers-reduced-motion`), hover lift on cards, 980px mobile collapse to a single column.

## What varies per roadmap

- **Accent palette** — one brand hue drives the whole page. The wizard offers these as named presets (purple is the default the template ships with; Other lets the user type any hue or brand color). Swap the `--brand*` tokens in both `:root` and `html[data-theme="light"]`, and tint the dark theme's `--bg` / `--panel-*` / `--line` toward the hue at low saturation (never leave gray panels under a warm brand). Proven sets:

  | Preset | Dark `--brand` / bright / deep | Light `--brand` / bright / deep | Mood |
  |---|---|---|---|
  | Purple | `#8b7cf0` / `#ab9dff` / `#4a3d8f` | `#5b45d6` / `#4a35b8` / `#cabfff` | template default — product, engineering |
  | Green | `#3fbf9f` / `#6adfc0` / `#1c6b56` | `#0e8a70` / `#0b6e59` / `#b5e6d9` | fresh, operational |
  | Gold | `#d9a441` / `#f0c46a` / `#8a6420` | `#9a6b12` / `#7d5408` / `#ecd9a8` | personal, north-star |

  Purple's dark neutrals ship in the template. For the other presets, re-tint the dark block: green = bg `#070d0b`/`#0b1512`, panels `#152420`/`#101a17`, lines `#2b3d35`/`#1e2b26`, ink `#e9f2ee`/`#b3c4bc`/`#75897f`, planned `#6f8078`; gold = bg `#0c0a07`/`#120f0a`, panels `#241d12`/`#1a1510`, lines `#3d3423`/`#2a2418`, ink `#f2ede2`/`#c4bcab`/`#877e6c`, planned `#80776b` (gold also earns warm light paper: `#faf6ee` bg, `#f5efe2` panel-b, `#2b2418` ink). For a typed hue, derive the same shape: mid-saturation brand, brighter tint, deep shade, an 18%-alpha glow, then re-tint the dark backgrounds. In light mode the neutrals (cool paper `#f5f3fb`, white panels, `#201d2b` ink) stay as the template ships them — only the brand triplet swaps.
- **Title, eyebrow, lede, footer** — the framing copy. The lede states the horizons (or the north-star thesis) in one sentence and always mentions that the page renders from the `ROADMAP` object. When a narrative doc exists behind the roadmap (a north-star memo, a business plan), the lede links it as the cover doc — the page is the map, the doc is the territory.
- **localStorage key** — both in the head snippet and the toggle handler.
- **Which sections appear and in what order** (below).

## Section catalog

Sections are entries in the `ROADMAP` object, dispatched on `kind`:

| Kind | Use when | Shape |
|---|---|---|
| `north` | multi-lane life/company roadmaps with one set of document-level finish lines | `{ label, outcomes: [{ icon, label, desc, when }] }` — page top, before any lane |
| `timeline` | every phase or lane with dated work | `{ title, tag, tagLabel, range, sub, variant?, periods, unplanned?, outcomes?, outcomesLabel? }` |
| `cards` | meta-project strips, long-term horizons, parked bets | `{ title, tag?, tagLabel?, range, sub, variant?, cols?, cards: [{ theme, note?, items?, focus? }] }` |

Timeline details:
- `tag`: `done` (brand accent), `plan` (cool blue), `moon` (green, a hard finish line like a season or event). `tagLabel` is free text — the tag picks the color family, the label says the truth ("Shipped", "In progress", "Planning", "Ramadan"). The current phase reads well as brand-accent + "In progress".
- `variant: "future"` recolors the whole section to the cool accent — use it for not-yet-started quarters so shipped and planned phases read differently at a glance.
- `periods`: 3–6 per timeline reads best. Each period is `{ name, milestones: [top, bottom?] }`; a missing bottom card renders an empty slot cleanly. More than ~6 periods cramps the rail — split into two sections instead.
- **Stacked rows**: a busy period can hold more than one milestone per row — make the row entry an array (`milestones: [[m1, m2], m3]`) and the cards stack in that slot joined by a short dashed link. Prefer a stack of two focused cards over one overstuffed card; more than two stacked starts to dwarf the neighboring periods.
- Milestone `items`: 1–4 lines each, ≤ ~60 characters — these are arc-level statements, not task descriptions.
- Milestone `unlocks` (optional): one mono `↳` line naming what shipping this milestone buys ("clean identity data · corridor SLAs"). Chained across a phase, the unlock lines narrate the sequence — why this order and not another. Use them wherever the ordering is deliberate; skip them where it isn't.
- **Semantic rows** (optional): the top and bottom card rows of a timeline can carry meaning — top lane rides the money path, bottom lane builds the machine under it; top = product, bottom = platform. When rows mean something, say so in the phase `sub` so the reader decodes the layout.

Cards details: `items` (status list) for active meta-arcs, `note` (one italic line) for parked bets; `focus: true` highlights the priority card; `cols: 3` for note-style grids, default 2 for item-style.

## The overflow pair

A roadmap is a filter, and both reject-streams get a home on the page. This is a convention, not decoration — it's what keeps the timeline honest and makes the next planning cycle cheaper:

- **Long-term horizon** (`cards` with `note`s) is the overflow **into** the roadmap: everything harvested that didn't earn a period lands here as a parked bet with an honest one-liner. Nothing gets silently dropped, and the next planning cycle starts by re-reading this section — it is the inbox for the next roadmap, which is why its sub says so ("parked deliberately — big bets to revisit each planning cycle").
- **Unplanned wins** (`unplanned` on a timeline) is the overflow **out of** the plan: real work that shipped without ever being on the roadmap, recorded as starred green cards above the outcomes band. It keeps a shipped phase truthful (the plan wasn't the whole story) and works on the current in-progress phase too, not just retrospectives.

Together they close the loop: planned-but-not-now flows to the horizon and re-enters later; done-but-never-planned surfaces as wins. When updating a roadmap, route displaced content through these two sections rather than deleting it.

## Two shapes, one system

- **Multi-lane (life / company north star)**: a `north` band up top, then one `timeline` per lane (each with its own deadline tag and outcomes), then a `cards` strip for the meta arcs behind the lanes. Lanes are parallel bets with different finish lines.
- **Phased (project / engineering)**: no `north` band; `timeline` sections in chronological order — shipped history first (`tag: done`, statuses backfilled honestly, `unplanned` wins celebrated), then future quarters (`variant: "future"`), then a `cards` horizon for long-term bets. History-then-future is the story arc: "here's what we built, here's what's next."

## Content rules

- **Statuses come from ground truth.** `done` means verifiably shipped (git history, a closed task, the operator's word) — never memory or optimism. When unsure between `progress` and `planned`, ask or downgrade to `planned`; an inflated roadmap erodes trust in the whole surface.
- **Arc altitude.** This page tracks the arc; the task board tracks the detail. A milestone item summarizes a theme of work, it doesn't enumerate tasks. If an item needs a second line to explain itself, it's too detailed.
- **Don't drop, demote.** Work that doesn't fit a period goes to a `cards` horizon or a later period, not deleted. Parked bets deserve a card with an honest note ("parked deliberately — revisit each planning cycle").
- **Honest horizons.** Ranges and `when` labels use real dates the operator gave or confirmed. A moon-dependent or external deadline gets said so in the footer.
- **Outcomes are earnings, not features.** Outcome tiles answer "what does finishing this buy us" (equity protected, ops calm, launch complete), not "what did we build".

## Output conventions

- Single self-contained file: inline CSS and JS, Google Fonts the only external dependency.
- Path by scope: `roadmap.html` at the root of whatever it covers — `<HOME>/roadmap.html` for a personal/company north star, `projects/<slug>/roadmap.html` for a project (both auto-discovered by the dashboard), a client repo's docs dir for its own. Confirm in the wizard; never guess a new location.
- The footer always explains how to read the page and that edits happen in the `ROADMAP` object.

## Render check

The renderer fails soft: one syntax error in the data object and the page silently renders header-only. After writing or editing the file, verify it actually renders — screenshot the `file://` URL (`browser_screenshot`) and confirm the sections appear, or at minimum parse-check the script block. Never hand off a roadmap on "the Write succeeded".
