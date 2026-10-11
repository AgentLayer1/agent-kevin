# Explainer page

An explanation worth more than a chat reply (an architecture walkthrough, a research note, a [how](playbooks/how.md) answer for a subsystem, a design an [architect](architect.md) pass settled) ends in one HTML page beside a short markdown card. The page is never hand-written: you write its body, and a script wraps it in [the shell](../templates/explainer.html), which owns the top bar, the contents dropdown, the Auto / Light / Dark theme and the diagrams. PR reviews and replies have their own page ([PR report](pr/report.md)).

## Writing it

`<skill dir>` is this skill's base directory, which every host shows when it loads the skill. The plugin's dependencies sit two levels up.

1. Make a scratch folder: `mktemp -d "$TMPDIR/explainer-XXXXXX"`. The body is `<folder>/body.html`; use that exact path in every later step.
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

Plain HTML, no `<script>`, `<style>`, `<link>` or event attributes (the check refuses them). In order:

- Optional `<p class="eyebrow">repo · kind</p>`, then exactly one `<h1>` (the page title and the tab title), then an optional `<p class="lede">` in one or two sentences.
- One `<section>` per part, each opening with an `<h2>`. Sections number themselves and fill the contents dropdown; keep titles short, since the top bar shows the one in view.
- Components: `.card` (add `.verdict` with `ok`, `warn` or `crit` for the headline answer), `.grid2` of cards (before and after), `.stats` of `<div class="stat"><b>42</b><span>what it counts</span></div>`, `<div class="table"><table>…</table></div>`, `.card.finding` with `crit`, `warn`, `info` or `ok` and an `<h4>`, `<span class="tag warn">label</span>`, `<p class="label">` above a card's text, `<p class="cap">` under a diagram, and `<details><summary>`.
- A diagram is `<pre class="diagram">` holding Mermaid source with `<`, `>` and `&` escaped (`&lt;br/&gt;`, `--&gt;`). One diagram per flow, with a caption.
- Prose stays a readable column on its own; tables, diagrams and grids take the full width.
