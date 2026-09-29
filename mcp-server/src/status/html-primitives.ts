/**
 * Markup primitives shared by the dashboard and focus page renderers.
 */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Stable hue per name (djb2 hash, full-width before the mod, so similar
 *  names land far apart) — used for project and skill badges. */
export const nameHue = (name: string): number => {
  let hash = 5381;
  for (const ch of name) hash = ((hash * 33) ^ (ch.codePointAt(0) ?? 0)) >>> 0;
  return hash % 360;
};
