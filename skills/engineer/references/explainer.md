# Explainer page

An explanation worth more than a chat reply (an architecture walkthrough, a research note, a [how](playbooks/how.md) answer for a subsystem, a design an [architect](architect.md) pass settled) ends in one HTML page beside a short markdown card. The page is never hand-written: you write its body, and a script wraps it in [the shell](../templates/explainer.html), which owns the top bar, the contents dropdown, the Auto / Light / Dark theme and the diagrams (each drawn diagram gets an expand button that opens it full-window with zoom and pan). PR reviews and replies have their own page ([PR report](pr/report.md)).

## Writing it

`<skill dir>` is this skill's base directory, which every host shows when it loads the skill. The plugin's dependencies sit two levels up.

1. Make a scratch folder: `mktemp -d "${TMPDIR:-/tmp}/explainer-XXXXXX"`. The body is `<folder>/body.html`; use that exact path in every later step.
2. Write the body (shape below), then validate it. This parses every diagram, so fix the body until it passes:

   ```bash
   NODE_PATH="<skill dir>/../../mcp-server/node_modules" bun "<skill dir>/scripts/explainer.ts" check "<body path>"
   ```

3. Save the card with `report_write` (usually `category: plans`): the verdict and the few points worth keeping, and a line saying the full page is the HTML beside it (same name, `.html`).
4. Write the page beside the card, using the `path` `report_write` returned:

   ```bash
   NODE_PATH="<skill dir>/../../mcp-server/node_modules" bun "<skill dir>/scripts/explainer.ts" write "<body path>" "<the absolute path report_write returned>"
   ```

   To change the page, edit the body and run `write` again.

## The body

Plain HTML: no `<script>`, `<style>`, `<link>`, `<iframe>`, `<form>`, `<object>`, `<embed>`, `<base>` or `<meta>`, no event attributes and no `javascript:` URLs (the check refuses them). In order:

- Optional `<p class="eyebrow">repo · kind</p>`, then exactly one `<h1>` (the page title and the tab title), then an optional `<p class="lede">` in one or two sentences.
- One `<section>` per part, each opening with an `<h2>`. Sections number themselves and fill the contents dropdown; keep titles short, since the top bar shows the one in view.
- Components: `.card` (add `.verdict` with `ok`, `warn` or `crit` for the headline answer), `.grid2` of cards (before and after), `.stats` of `<div class="stat"><b>42</b><span>what it counts</span></div>`, `<div class="table"><table>…</table></div>`, `.card.finding` with `crit`, `warn`, `info` or `ok` and an `<h4>`, `<span class="tag warn">label</span>`, `<p class="label">` above a card's text, `<p class="cap">` under a diagram, and `<details><summary>`.
- A diagram is `<pre class="diagram">` holding Mermaid source with `<`, `>` and `&` escaped (`&lt;br/&gt;`, `--&gt;`). One diagram per flow, with a caption.
- A code block is a plain `<pre>` with the same escaping. It is highlighted on load, with TypeScript, SQL or JSON detected; `data-lang` forces a language.
- A walkthrough lets a reader step through a flow on one picture: `<div class="walkthrough">` holding an inline `<svg>` whose parts carry `data-wt="id"` (plus one `data-wt-token` element that travels), then `<pre class="wt-script">` with JSON `{ "scenarios": [{ "title", "summary", "steps": [{ "time", "title", "color", "lit": [ids], "at": id, "text", "subs": [lines], "chips": [{ "text", "tone" }], "code", "table": { "title", "head", "rows", "empty" } }] }] }`. The shell adds scenario tabs, play and step controls, a timeline and a detail panel, dims what a step doesn't light, and deep-links with `#wt=scenario.step`. Chip tones are the tag tones plus `in` and `out`. The check parses the JSON and refuses an id the svg lacks.
- Reveal cards put a short phrase up front and the detail one click away: `<div class="reveal">` holding `<div class="reveal-cards">` of `<button class="reveal-card" data-reveal="name" style="--c:<colour>"><b>Title</b><span>three or four words</span></button>`, then one `<div class="reveal-panel" data-reveal-panel="name"><div><div class="reveal-body">…</div></div></div>` per card. A panel body takes any markup; `reveal-row` (a `reveal-icon` tile, then a `<div>` with `<b>` and `<span>`) gives the icon-title-line rows. One panel is open at a time, it animates open, Escape closes it, and with no script every panel shows. The check refuses a card without its panel and a panel without its card.
- A UI mock shows what people would see, clickable: `<div class="mock" data-mock-url="…" data-mock-state="start">` gets browser chrome and a Reset button. Inside, the shell styles `mock-app` (with a `mock-side` nav and `mock-main`), `mock-duo` + `mock-aside` + `mock-phone`, `mock-head`, `mock-tabsbar`, `mock-panel`, `mock-kpis`, `mock-rows`, `mock-scroll` (wrap a wide table so it scrolls sideways), `mock-chain` of `mock-link` (a left-to-right chain with arrows; `--c` colours a link, `end` and `gap` mark its ends and holes), `mock-steps`, `mock-feed`, `mock-track`, `mock-btn` (`primary`, `danger`, `risk`, `ghost`, `sm`), `mock-pill` (`ok`, `warn`, `crit`, `info`), `mock-option`, `mock-field`, `mock-note`, `mock-sim` and `<dialog>`. Behaviour is attributes: `data-mock-when` / `data-mock-unless` show by the nearest `data-mock-state` (a row can hold its own), `data-mock-go="s"` sets it (`+s` / `-s` add or drop a flag), `data-mock-open="id"` opens a dialog (any button in it closes it, acting on the row that opened it), `data-mock-apply` copies the dialog's named fields into `data-mock-field` slots, `data-mock-needs="selection reason"` disables until met, `data-mock-select="one|many"` + `data-mock-item` selects, `data-mock-sort` drags to reorder (renumbering `data-mock-rank`), `data-mock-remove` removes with Undo, `data-mock-toast` confirms, `data-mock-tab` / `data-mock-pane` switch (a pane can name several tabs, so a step-through can keep what earlier tabs added). The check refuses a dialog, state or pane that doesn't exist.
- Prose stays a readable column on its own; tables, diagrams and grids take the full width.
