/**
 * The expand-and-zoom view every generated HTML page gives its diagrams. Any `.diagram` element
 * holding a drawn `<svg>` gets a corner button that opens it full-window, with zoom (buttons, keys,
 * pinch or ⌘-scroll) and drag to pan. Pages keep drawing as before; the block watches for the SVG.
 *
 *   bun mcp-server/src/shared/diagram-viewer.ts sync   rewrite the block in every template that draws diagrams
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const START = '<!-- diagram-viewer:start -->';
const END = '<!-- diagram-viewer:end -->';

export const DIAGRAM_VIEWER_BLOCK = `${START}
<style>
  .diagram { position: relative; }
  .dv-open { all: unset; box-sizing: border-box; position: absolute; top: 8px; right: 8px; z-index: 2; display: grid; place-items: center; width: 30px; height: 30px;
    border-radius: 8px; cursor: pointer; color: CanvasText; opacity: .35; transition: opacity .15s;
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); background: color-mix(in srgb, Canvas 85%, transparent); }
  .diagram:hover .dv-open, .dv-open:focus-visible { opacity: 1; }
  .dv-open svg { width: 15px; height: 15px; display: block; }
  dialog.dv { width: 96vw; height: 94vh; max-width: none; max-height: none; padding: 0; overflow: hidden; border-radius: 14px;
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); background: Canvas; color: CanvasText; }
  dialog.dv[open] { display: flex; flex-direction: column; }
  dialog.dv::backdrop { background: rgba(0, 0, 0, .55); backdrop-filter: blur(3px); }
  .dv-bar { display: flex; gap: 6px; align-items: center; padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    font: 12px/1.2 ui-monospace, "IBM Plex Mono", monospace; }
  .dv-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 14px/1.2 system-ui, sans-serif; }
  .dv-bar button { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 7px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); }
  .dv-bar button:hover, .dv-bar button:focus-visible { background: color-mix(in srgb, CanvasText 9%, transparent); }
  .dv-zoom { min-width: 46px; text-align: center; opacity: .7; }
  .dv-stage { flex: 1; display: flex; overflow: auto; cursor: grab; touch-action: none; outline: none; }
  .dv-stage.dragging { cursor: grabbing; }
  .dv-stage > svg { margin: 20px auto auto; flex: none; max-width: none !important; }
  @media print { .dv-open { display: none; } }
</style>
<script>
(() => {
  const ICON = "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4' fill='none' stroke='currentColor' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>";
  const MIN = 0.1;
  const MAX = 8;
  const STEP = 1.25;
  let dialog = null;
  let stage = null;
  let label = null;
  let heading = null;
  let current = null;
  let shown = null;
  let natural = { width: 1, height: 1 };
  let scale = 1;

  const clamp = (value) => Math.min(MAX, Math.max(MIN, value));

  const button = (text, title, onClick) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = text;
    node.title = title;
    node.setAttribute("aria-label", title);
    node.addEventListener("click", onClick);
    return node;
  };

  const apply = () => {
    const svg = stage.firstElementChild;
    if (!svg) { return; }
    svg.style.width = natural.width * scale + "px";
    svg.style.height = natural.height * scale + "px";
    label.textContent = Math.round(scale * 100) + "%";
  };

  // Zoom around the middle of the view, so the part being read stays put.
  const zoomTo = (next) => {
    const middleX = (stage.scrollLeft + stage.clientWidth / 2) / scale;
    const middleY = (stage.scrollTop + stage.clientHeight / 2) / scale;
    scale = clamp(next);
    apply();
    stage.scrollLeft = middleX * scale - stage.clientWidth / 2;
    stage.scrollTop = middleY * scale - stage.clientHeight / 2;
  };

  const whole = () => Math.min((stage.clientWidth - 40) / natural.width, (stage.clientHeight - 40) / natural.height);

  const fit = () => {
    scale = clamp(whole());
    apply();
  };

  // Open at the window's width, never past actual size, so a tall diagram reads larger than inline and scrolls; Fit shows all of it.
  const initial = () => {
    scale = clamp(Math.max(whole(), Math.min(1, (stage.clientWidth - 40) / natural.width)));
    apply();
  };

  const show = () => {
    const source = current.querySelector(":scope > svg");
    if (!source) { return; }
    const box = source.viewBox && source.viewBox.baseVal;
    const rect = source.getBoundingClientRect();
    natural = box && box.width ? { width: box.width, height: box.height } : { width: rect.width || 1, height: rect.height || 1 };
    const svg = source.cloneNode(true);
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    stage.replaceChildren(svg);
    shown = source;
    apply();
  };

  const build = () => {
    dialog = document.createElement("dialog");
    dialog.className = "dv";
    dialog.setAttribute("aria-label", "Diagram");
    heading = document.createElement("span");
    heading.className = "dv-title";
    label = document.createElement("span");
    label.className = "dv-zoom";
    const bar = document.createElement("div");
    bar.className = "dv-bar";
    bar.append(heading, button("−", "Zoom out (-)", () => zoomTo(scale / STEP)), label, button("+", "Zoom in (+)", () => zoomTo(scale * STEP)),
      button("Fit", "Fit to window (0)", fit), button("1:1", "Actual size (1)", () => zoomTo(1)), button("✕", "Close (Esc)", () => dialog.close()));
    stage = document.createElement("div");
    stage.className = "dv-stage";
    stage.tabIndex = -1;
    dialog.append(bar, stage);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) { dialog.close(); } });
    dialog.addEventListener("close", () => { current = null; shown = null; stage.replaceChildren(); });
    dialog.addEventListener("keydown", (event) => {
      const action = { "+": () => zoomTo(scale * STEP), "=": () => zoomTo(scale * STEP), "-": () => zoomTo(scale / STEP), "0": fit, "1": () => zoomTo(1) }[event.key];
      if (action) { event.preventDefault(); action(); }
    });
    // A trackpad pinch arrives as a wheel event with ctrlKey set.
    stage.addEventListener("wheel", (event) => {
      if (!event.ctrlKey && !event.metaKey) { return; }
      event.preventDefault();
      zoomTo(scale * Math.exp(-event.deltaY / 250));
    }, { passive: false });
    let drag = null;
    stage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) { return; }
      drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
      stage.setPointerCapture(event.pointerId);
      stage.classList.add("dragging");
    });
    stage.addEventListener("pointermove", (event) => {
      if (!drag) { return; }
      stage.scrollLeft = drag.left - (event.clientX - drag.x);
      stage.scrollTop = drag.top - (event.clientY - drag.y);
    });
    const release = () => { drag = null; stage.classList.remove("dragging"); };
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);
    document.body.append(dialog);
  };

  const titleOf = (box) => {
    const container = box.closest("figure, .card, section, article");
    const found = container && container.querySelector("figcaption, h1, h2, h3, h4");
    return box.dataset.title || (found && found.textContent.trim()) || "Diagram";
  };

  const open = (box) => {
    if (!dialog) { build(); }
    current = box;
    heading.textContent = titleOf(box);
    show();
    dialog.showModal();
    stage.focus();
    requestAnimationFrame(initial);
  };

  // Pages draw (and redraw on a theme flip) by replacing a .diagram's contents, so watch for the SVG instead of hooking each page's renderer.
  const attach = (box) => {
    const svg = box.querySelector(":scope > svg");
    if (!svg) { return; }
    if (!box.querySelector(":scope > .dv-open")) {
      const opener = document.createElement("button");
      opener.type = "button";
      opener.className = "dv-open";
      opener.title = "Expand diagram";
      opener.setAttribute("aria-label", "Expand diagram");
      opener.innerHTML = ICON;
      opener.addEventListener("click", () => open(box));
      box.append(opener);
    }
    if (box === current && dialog && dialog.open && shown !== svg) { show(); }
  };

  const start = () => {
    document.querySelectorAll(".diagram").forEach(attach);
    new MutationObserver((records) => records.forEach((record) => {
      const box = record.target.closest && record.target.closest(".diagram");
      if (box) { attach(box); }
    })).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", start); } else { start(); }
})();
</script>
${END}`;

/** Templates that draw Mermaid into `.diagram` boxes; each carries the block verbatim, right after the theme block. */
export const DIAGRAM_TEMPLATES = ['skills/engineer/templates/explainer.html', 'skills/engineer/templates/pr-report.html'] as const;

const BLOCK = new RegExp(`${START}[\\s\\S]*?${END}`);

/** The block a page carries, or null when it has none. */
export const diagramViewerBlockOf = (html: string): string | null => BLOCK.exec(html)?.[0] ?? null;

export const withDiagramViewerBlock = (html: string): string => html.replace(BLOCK, () => DIAGRAM_VIEWER_BLOCK);

if (import.meta.main) {
  const pluginRoot = join(import.meta.dir, '..', '..', '..');
  if (process.argv[2] !== 'sync') {
    console.error('usage: bun diagram-viewer.ts sync');
    process.exit(1);
  }
  DIAGRAM_TEMPLATES.forEach((relative) => {
    const path = join(pluginRoot, relative);
    const html = readFileSync(path, 'utf-8');
    if (diagramViewerBlockOf(html) === null) {
      console.error(`${relative}: no ${START} … ${END} block in <head>`);
      process.exit(1);
    }
    const next = withDiagramViewerBlock(html);
    if (next !== html) {
      writeFileSync(path, next);
      console.log(`synced ${relative}`);
    }
  });
}
