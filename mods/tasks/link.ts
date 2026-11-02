// Ported from mcp-server/src/tasks/link.ts `rewriteLinks` (a mod can't import Node code): the same
// protected spans, but it writes markdown links for a terminal instead of wikilinks for Obsidian.

export const MAY_HOLD_ID = /[a-z]{2}-\d/;

// One capture group, so `split` alternates free text (even indices) and protected spans (odd).
const PROTECTED =
  /(```[\s\S]*?```|`[^`\n]+`|\[[^\]\n]*\]\([^)\n]*\)|\[[^\]\n]*\]:|\[\[[^\]\n]*\]\]|(?:https?|file):\/\/\S+)/;
const FREE_ID = /(?<![\w/.-])[a-z]{2,}-\d{3,}(?![\w-])/g;
const CODE_ID = /^`([a-z]{2,}-\d{3,})`$/;

/**
 * Leaves code, links and URLs alone, except an inline code span that is exactly an id, which is linked whole.
 */
export const linkTaskIds = (text: string, hrefs: ReadonlyMap<string, string>): string => {
  if (hrefs.size === 0) {
    return text;
  }
  const linkFree = (chunk: string) =>
    chunk.replace(FREE_ID, (id) => (hrefs.has(id) ? `[${id}](${hrefs.get(id)})` : id));
  const linkSpan = (span: string) => {
    const href = hrefs.get(CODE_ID.exec(span)?.[1] ?? '');
    return href ? `[${span}](${href})` : span;
  };
  return text
    .split(PROTECTED)
    .map((part, index) => (index % 2 === 0 ? linkFree(part) : linkSpan(part)))
    .join('');
};
