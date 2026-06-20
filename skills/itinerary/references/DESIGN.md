# Itinerary Design System

`references/template.html` is a complete worked example (a 2-day Selangor coast weekend). It is the **aesthetic contract**: a light-mode, timeline-and-card layout, print-ready. Copy it, replace the content, compose the modules your trip needs. Don't redesign it from scratch, and don't drift back toward a big-serif "magazine" look — the star here is the **timeline of cards**, not editorial whitespace.

## What stays fixed

- **Light mode only.** Warm off-white background, white cards, soft shadows, rounded corners. No dark mode, no theme toggle.
- **The day timeline.** Every day is a vertical rail of **period markers** — Morning, Afternoon, Evening — each a coloured circle (amber sun / teal cloud / indigo moon) on the rail, with one or more **activity cards** beside it. This is the structural heart of the design.
- **Periods, not clock times.** Label by part of day (Morning / Afternoon / Evening), never "09:00". When a block spans days, prefix the period ("Day 5 · Morning"). A logistics or drive row can sit above a period when needed.
- **The Options block.** Every day ends with a **"More options"** period (dashed, tinted cards, ✦ marker): things that didn't fit, backups if a plan falls through, or extras for spare time / good weather. Nothing researched gets thrown away — overflow becomes options.
- **Activity cards.** Emoji tile + title + 1–3 sentence description + tag chips. Cards with extra detail get the `x` class and a chevron; tapping expands an hours/price grid and tip(s). On paper, all detail auto-expands.
- **Summaries everywhere.** Every **day** opens with a one-line `.day-sum` ("what this day is"); every **section** opens with a one-line `.sec-sum`. The reader should never hit a heading with no context.
- **The print button + `@media print`.** White page, nav hidden, one day per printed page, cards never split, all detail expanded, videos hidden. Never remove or weaken this block.
- **Restraint.** At most two accent colours on the page (the destination accent + gold for prices); period colours are fixed.

## What varies per trip

- **Accent hue** (`--accent` / `--accent-deep` / `--accent-wash`): one hue matching the destination's mood, the three tokens derived from it. Coastal/island teal `#19646e`, highland moss `#4a6741`, tropical jungle green `#13796a`, heritage burgundy `#7a2e3a`, desert terracotta `#a8512e`. One hue only; period and gold colours don't change.
- **Masthead** copy and the meta chips (dates, travellers + age range, distance/flights, budget).
- **Month label** on the day numerals: set `.day-num::before { content: "Jun" }` to the trip's month so each big day number carries a small month tag above it.
- **Route-ribbon order numbers**: number the ribbon dots in visiting order (`1`, `2`, …) with `⌂` for home/start/end, so the sequence is unambiguous. Flight legs use the gold `.r-stop.fly` dot.
- **Which modules appear** (below).

## Module catalog

Compose from these; each exists in the template or the larger reference build.

| Module | Use when | Notes |
|---|---|---|
| Masthead | always | Gradient banner in the accent hue; meta chips incl. who's going + ages |
| Sticky nav + print | always | Links to days + sections; print button always present |
| Route ribbon | road trips, multi-city | Stops with nights + dotted legs labelled `🚗 1h15` / `⛴` / `✈` |
| Season note | most trips | One accent-tinted line on timing/weather/crowds |
| Flight cards | any trip with flights | Route, times, flight no., duration, price/pax |
| Phase bar | trips long enough to group days | Icon + title + day-range sub-line |
| Day section | always | Numeral, kicker, title, badges, `.day-sum` summary, then the timeline |
| Period (Morning/Afternoon/Evening) | always | Coloured marker on the rail; holds the cards |
| Activity card | always | Add `x` + chevron + `.acard-detail` for expandable hours/price/tips |
| Drive-leg connector | road trips | Dotted row between cards when the family gets back in the car |
| **Options period** | **always** | Dashed, tinted ✦ block at the end of each day — overflow, backups, spare-time extras |
| Route map | multi-city / road trips | Stylized inline SVG: simple landmasses, numbered dots, dashed routes, legend. Magazine-infographic, not GPS. Stays in print. |
| Watch section | multi-day trips | Grid of real YouTube videos (thumb `https://img.youtube.com/vi/<ID>/hqdefault.jpg`, link to watch URL). Verified IDs only; fall back to `youtube.com/results` search links with `.vthumb.search`. Hidden in print. |
| Drives table | multi-leg trips | Every transfer in order: from→to, mode, time, notes |
| Budget table | paid trips | Mark estimates `.est`; total row; a "where to trim" note helps |
| Good-to-know grid | always | 3–8 cards drawn from the trip's needs: timing, family/pacing, pre-bookings, health, safety, plus any constraint cards the user requires (e.g. halal/dietary, prayer, accessibility) |
| Seasonal calendar | bigger trips | When each region is best / what to avoid |
| Checklist | overnight trips | Grouped (bookings / packing / apps); persists via localStorage |

## Flavors

Flavors are flags, not separate templates. Combine freely:

- **Single-day**: one day section, Morning/Afternoon/Evening + Options; no route ribbon or checklist; nav links to parts of the day.
- **Multi-day (default)**: a day section per day (or per short block), phase bars if long, plus map/watch/budget/checklist/good-to-know.
- **Road trip**: route ribbon, drive-leg connectors, per-day driving badge, route map, fuel/toll line in budget, Plan-B tips on weather-dependent stops.
- **Fly-in / multi-city**: flight cards in the overview; route ribbon with nights per stop; airport-buffer notes on first/last day.

## Content rules

- **Verify before claim.** Every specific (price, opening hour, flight number, drive time, "closed Mondays") comes from this session's research, or it doesn't appear. Estimates are labelled (`~`, `.est`, "reconfirm"). Never invent a restaurant, hotel, or price to fill a slot.
- **Don't drop, demote.** When a stop won't fit the day, move it to that day's Options block rather than cutting it. Comprehensiveness is a feature; the Options block is where it lives.
- **Respect the user's constraints.** Read the trip project README first (or the user's preferences when there's no project). Constraints vary per user: dietary rules (halal, kosher, vegetarian, allergies), prayer- or accessibility-aware scheduling, kid/elder pacing, budget norms. Include constraint-specific modules and chips only when the constraints call for them. Where a constraint needs on-the-ground checking (for halal: "Muslim-owned ✓" vs "Muslim-friendly, verify on arrival"), label it honestly. The worked example's halal/prayer cards are one user's constraints, not a default; swap them for the active user's.
- **Realistic days.** Buffer drive times, respect meal and nap windows, at most one anchor activity per period. An itinerary that survives contact with a 6-year-old is the goal.
- **Plan B where it matters.** Any weather-dependent or sells-out anchor gets a fallback in its tip and/or the Options block.
- **Links**: place names link to Google Maps search URLs; bookings to the official site found in research. Real links, not guessed slugs.

## Output conventions

- Path: `<HOME>/projects/<trip-project>/itineraries/<trip-slug>-v<N>.html`. Check for existing versions and increment; never overwrite a previous version.
- Single self-contained file: inline CSS and JS, Google Fonts the only external dependency. The layout must look finished with no external images.
- Add/update the itinerary link in the trip project README.

## Print check

After writing the file, render to PDF (`browser_pdf` on the `file://` URL) and confirm: each day starts on its own page, no card split mid-block, all card detail expanded, videos hidden, tables and checklist intact at A4. If a day overflows, tighten descriptions rather than shrinking the font.
