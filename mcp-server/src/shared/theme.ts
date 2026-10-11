/**
 * The Auto / Light / Dark control every generated HTML page shares. It goes in `<head>` so the
 * theme is set before first paint; a page keys its palette on `html[data-theme="light" | "dark"]`.
 *
 *   bun mcp-server/src/shared/theme.ts sync   rewrite the block in every themed template
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const START = '<!-- theme:start -->';
const END = '<!-- theme:end -->';

export const THEME_BLOCK = `${START}
<style>
  .theme-switch { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; color: inherit;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent); background: color-mix(in srgb, currentColor 5%, transparent); }
  .theme-switch.floating { position: fixed; top: 14px; right: 14px; z-index: 50;
    background: color-mix(in srgb, Canvas 82%, transparent); backdrop-filter: blur(8px); }
  .theme-switch button { all: unset; box-sizing: border-box; cursor: pointer; width: 28px; height: 24px; border-radius: 999px;
    display: grid; place-items: center; opacity: .55; transition: opacity .15s, background .15s; }
  .theme-switch button:hover { opacity: .9; }
  .theme-switch button[aria-pressed="true"] { opacity: 1; background: color-mix(in srgb, currentColor 15%, transparent); }
  .theme-switch button:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
  .theme-switch svg { width: 14px; height: 14px; display: block; }
  @media print { .theme-switch { display: none !important; } }
</style>
<script>
(() => {
  const KEY = "agent-theme";
  const CHOICES = {
    auto: ["Auto, follows the system", "<svg viewBox='0 0 16 16' aria-hidden='true'><circle cx='8' cy='8' r='6' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M8 2a6 6 0 0 1 0 12z' fill='currentColor'/></svg>"],
    light: ["Light", "<svg viewBox='0 0 16 16' aria-hidden='true'><circle cx='8' cy='8' r='3' fill='currentColor'/><path d='M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/></svg>"],
    dark: ["Dark", "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M13.5 10.2A5.8 5.8 0 0 1 5.8 2.5a5.8 5.8 0 1 0 7.7 7.7z' fill='currentColor'/></svg>"],
  };
  const root = document.documentElement;
  const media = matchMedia("(prefers-color-scheme: dark)");
  const read = () => { try { const saved = localStorage.getItem(KEY); return Object.hasOwn(CHOICES, saved) ? saved : "auto"; } catch (e) { return "auto"; } };
  let choice = read();
  const apply = () => {
    const mode = choice === "auto" ? (media.matches ? "dark" : "light") : choice;
    const changed = root.getAttribute("data-theme") !== mode;
    root.setAttribute("data-theme", mode);
    root.style.colorScheme = mode;
    document.querySelectorAll(".theme-switch button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.choice === choice)));
    if (changed) { document.dispatchEvent(new CustomEvent("themechange", { detail: { mode } })); }
  };
  const choose = (next) => {
    choice = next;
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply();
  };
  const mount = () => {
    const slot = document.getElementById("theme-slot");
    const group = document.createElement("div");
    group.className = slot ? "theme-switch" : "theme-switch floating";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Theme");
    Object.entries(CHOICES).forEach(([name, [label, icon]]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.choice = name;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = icon;
      button.addEventListener("click", () => choose(name));
      group.append(button);
    });
    (slot || document.body).append(group);
    apply();
  };
  media.addEventListener("change", () => { if (choice === "auto") { apply(); } });
  window.addEventListener("storage", (event) => { if (event.key === KEY) { choice = read(); apply(); } });
  apply();
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", mount); } else { mount(); }
})();
</script>
${END}`;

/** Templates opened or copied whole, so they carry the block verbatim; rendered pages fill a slot instead. */
export const THEMED_TEMPLATES = [
  'skills/engineer/templates/explainer.html',
  'skills/engineer/templates/pr-report.html',
  'skills/itinerary/references/template.html',
  'skills/roadmap/references/template.html',
] as const;

const BLOCK = new RegExp(`${START}[\\s\\S]*?${END}`);

/** The block a page carries, or null when it has none. */
export const themeBlockOf = (html: string): string | null => BLOCK.exec(html)?.[0] ?? null;

export const withThemeBlock = (html: string): string => html.replace(BLOCK, () => THEME_BLOCK);

const PLUGIN_ROOT = join(import.meta.dir, '..', '..', '..');

if (import.meta.main) {
  if (process.argv[2] !== 'sync') {
    console.error('usage: bun theme.ts sync');
    process.exit(1);
  }
  THEMED_TEMPLATES.forEach((relative) => {
    const path = join(PLUGIN_ROOT, relative);
    const html = readFileSync(path, 'utf-8');
    if (themeBlockOf(html) === null) {
      console.error(`${relative}: no ${START} … ${END} block in <head>`);
      process.exit(1);
    }
    const next = withThemeBlock(html);
    if (next !== html) {
      writeFileSync(path, next);
      console.log(`synced ${relative}`);
    }
  });
}
