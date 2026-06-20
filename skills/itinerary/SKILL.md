---
name: itinerary
description: Plan a trip end-to-end and generate a polished, interactive, print-ready HTML itinerary. Use whenever the user wants to plan a vacation, family trip, day trip, road trip, or weekend getaway, asks for an itinerary, or wants help organizing travel dates, flights, routes, or hotels, even if they never say the word "itinerary". Wizard-style: interview first, then web research (flights, drive times, prices, opening hours, halal food, weather), then render the itinerary HTML into the trip project.
disable-model-invocation: true
allowed-tools: AskUserQuestion, WebSearch, WebFetch, Read, Write, Edit, Glob, Grep, Bash, mcp__plugin_agent-kevin_kevin__serpapi_search, mcp__plugin_agent-kevin_kevin__perplexity_search, mcp__plugin_agent-kevin_kevin__browser_pdf, mcp__plugin_agent-kevin_kevin__task_query, mcp__plugin_agent-kevin_kevin__task_thread
---

# Itinerary

Turn a trip idea into a researched, beautiful, printable HTML itinerary. The deliverable is a single self-contained file the family can scroll on a phone, click through on a laptop, or print and stick on the fridge.

Three phases: **interview → research → render**. Don't skip the interview (guessed preferences produce generic itineraries) and don't render before research (an itinerary full of invented prices and made-up restaurants is worse than none).

## Phase 0 · Context (no questions yet)

Gather what's already known so the interview asks only what's genuinely open:

1. Find a trips project: look for `<HOME>/projects/*/itineraries/` (a project whose README is about travel, e.g. `family-trips`). If one exists, read its README, especially any **constraints** section. Constraints vary per user and drive the whole plan: dietary rules (halal, kosher, vegetarian, allergies), prayer- or accessibility-aware scheduling, kid or elder pacing, school calendar, budget norms.
2. If no trips project exists, don't assume one. Pull travel-relevant constraints from the user's own knowledge instead (`<HOME>/knowledge/user/preferences.md`, `USER.md`, or whatever the harness exposes), and plan to **offer creating a project** to house the itinerary (see Phase 3) rather than inventing a folder.
3. Check for an existing task for this trip (`task_query` on the project, if there is one) and any prior itinerary versions for the same destination in `itineraries/`. A v2 request inherits the v1's decisions; ask only about what changes.
4. Note today's date and any school-holiday or seasonal windows the README, task, or user preferences mention.

## Phase 1 · Wizard interview

Two rounds of `AskUserQuestion`, max 4 questions each. Derive options from context instead of asking open-ended blanks (offer candidate date windows, not "when?").

**The wizard is skippable.** If the user already supplied the answers (a drafted itinerary, trip notes, a detailed request), extract everything from that material first and ask only about the gaps; don't make them re-answer what they already wrote. Round 1 should also carry an explicit escape hatch as an option ("I'll just tell you" / "use my draft as the base") so the operator can dump information in one go instead of clicking through rounds. When they take it, parse their dump and proceed straight to the final screen.

**Round 1: shape of the trip**
- Destination(s), if not already given.
- Dates: offer concrete windows (upcoming school holidays, long weekends) plus "you find the best window", which makes date research part of Phase 2.
- Duration and flavor: confirm what you infer (day trip / multi-day / road trip / fly-in). Don't ask what's obvious; Langkawi from KL is a flight or a long drive+ferry, so ask which, not whether.
- Who's going: always establish whether it's just the user or a group, exactly who joins (kids, grandparents, friends), and the age range of the group. Ages drive pacing, activity selection, and pricing tiers, so even when the project README names a default family, confirm who's actually coming on THIS trip.

**Round 2: texture (build from Round 1 answers)**
- Pace: packed days vs one anchor activity per day.
- Interests to anchor on (beach, nature, food, history, theme parks); use multiSelect.
- Budget ceiling for the whole trip.
- Accommodation style (one base vs moving, resort vs apartment) and any must-do or must-avoid.

**Final screen (always, even when the rounds were skipped):** one last `AskUserQuestion` before research starts: "Anything else I should know before I research and build this?" with a "Nothing to add, go ahead" default option. When there's no trips project yet, fold the save-location decision in here ("I'll save this under a new `trips` project — sound good?") so it's settled before render. Anything they type via Other (criteria, hopes, things to avoid, context the questions never asked about) gets woven into the research plan and the itinerary. This is the operator's free-form slot; never start Phase 2 without offering it.

If research later surfaces a genuine fork (two viable routes, two hotel zones, flight time vs price tradeoff), come back with one more focused question round. Present the fork with real data, not hypotheticals.

## Phase 2 · Research

Research scales with the trip: a half-day outing needs a handful of searches; a 10-day road trip deserves parallel fan-out (spawn Explore/general-purpose agents per dimension for big trips). Cover what applies:

- **Getting there**: flight options with airline, rough price, duration (serpapi/WebSearch); or drive route, realistic time, tolls. For "find the best window" requests: compare 2-3 candidate windows on price, weather, and crowds, then bring the fork back to the user.
- **Season check**: monsoon side, rainy months, jellyfish season, haze, major holidays driving crowds and prices. This kills more trips than anything else; check it early.
- **Anchor activities**: opening hours, ticket prices, closed days, booking requirements, age suitability.
- **Food**: options that satisfy the user's dietary constraints near each anchor (halal, kosher, vegetarian, allergy-aware, whatever the constraints specify). Label honestly when a constraint needs on-site verification (for halal: "Muslim-owned ✓" vs "Muslim-friendly, verify on arrival"). With no stated dietary constraint, research well-reviewed local food broadly.
- **Constraint-specific logistics** (only when the constraints call for it): e.g. prayer spaces (masjids/suraus) for Muslim travellers, step-free access, or nursing rooms, near the route and anchors.
- **Accommodation**: 2-3 candidates in the right zone with rough nightly rates and the features that matter (family rooms, surau, pool).
- **Practical**: emergency facilities nearby, cash-only quirks, ferry/last-entry cutoffs.
- **Watch list**: 6-12 real YouTube videos on the destination(s) from popular travel guides/influencers, family-appropriate. Every video ID must come from an actual youtube.com URL seen in search results this session; a fabricated ID produces a dead embed, which is worse than no video. When nothing verifiable surfaces for a spot, use a YouTube search link instead.

Rules: specifics that go in the itinerary need a source from this session; estimates get marked as estimates; if something can't be verified, say "reconfirm on booking" rather than asserting it. Note the research date for the footer.

## Phase 3 · Render

1. Read `references/DESIGN.md`, then `references/template.html`. The template is the aesthetic contract: a light-mode **timeline of cards**, not a magazine spread. DESIGN.md says which modules to compose for this trip's flavor and what varies (accent color, masthead, modules).
2. Structure every day as **Morning / Afternoon / Evening** periods on the timeline — never clock times like "09:00". End every day with a **"More options"** block: anything that didn't fit the day, backups if a plan falls through, and extras for spare time or good weather. Don't drop researched material — demote it to options. Give every day a one-line summary and every closing section a one-line summary.
3. Write the itinerary to `<HOME>/projects/<trip-project>/itineraries/<trip-slug>-v<N>.html` (check for existing versions, increment, never overwrite). If no trips project exists, create a lightweight one first (the decision was settled on the final interview screen): `projects/<slug>/` with a one-line README and an `itineraries/` folder. If the user declined a project, save to the location they picked rather than inventing a path.
4. Print check: render to PDF via `browser_pdf` and confirm clean page breaks (one day per page, no split cards, detail expanded, videos hidden).
5. Link the new file from the trip project README, and append a short note to the trip's task thread if one exists (`task_thread`).
6. Open it for the user, then give a 3-5 line summary: route, total budget, the one decision still open (e.g. "hotel not booked, two candidates in Good to Know"). Open only if this session's Bash tool runs unsandboxed (if its description mentions a command sandbox, app launches fail: skip the launch and just include the `file://` path so the user can open it). Use the platform's opener: `open` on macOS, `start "" <file>` on Windows, `xdg-open` on Linux. If it errors, don't retry with other launchers, just give the path.

## Iterating

After the itinerary exists, adjustments happen **conversationally and surgically**: when the user says "swap day 3's afternoon" or "add a stop in Ipoh" or "the hotel changed", apply targeted `Edit` calls to the existing HTML file rather than regenerating it. The file is the living document. Keep the day nav, route ribbon, map, and budget consistent with any content edit (a moved day changes all four), and re-run the print check after edits that add or remove blocks. Never regenerate the whole file for a small change: regeneration loses verified facts and the user's mental map of the document.

A structural rethink (different dates, different route, different trip shape) gets a new version file; cosmetic and content adjustments stay in the same version until the user blesses it.

## Failure modes to avoid

- **Skipping the wizard** because the request seems complete. "Plan Langkawi in July" still leaves pace, budget, and anchors open; one round minimum.
- **Inventing specifics.** A made-up restaurant name or ticket price destroys trust in the whole document. Unverified slots get honest placeholders ("dinner near the jetty, pick on arrival").
- **Overstuffed days.** Two anchor activities per day with kids is the ceiling, one is better. Buffer all drive times. Surplus ideas go in the Options block, not crammed into the periods.
- **Dropping content to fit.** Comprehensiveness is the point — if a worthwhile stop doesn't fit the day, demote it to Options rather than cutting it. A thin itinerary that "fits" is worse than a rich one with clear options.
- **Breaking print.** The print stylesheet is part of the deliverable; run the PDF check every time, including after edits.
- **Redesigning the template.** New flavors compose existing modules. If the design system genuinely can't express something, extend the template file deliberately and note it for the next trip.
