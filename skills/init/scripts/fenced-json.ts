/**
 * The first ```json fence after `anchor` in a skill's markdown, parsed. Line endings are
 * normalized first because Git for Windows checks the plugin out with CRLF by default.
 */
export const fencedJsonAfter = <T>(markdown: string, anchor: string): T => {
  const text = markdown.replace(/\r\n/g, '\n');
  const at = text.indexOf(anchor);
  const fence = text.indexOf('```json\n', at);
  const close = text.indexOf('\n```', fence + 8);
  if (at === -1 || fence === -1 || close === -1) {
    throw new Error(`init SKILL.md no longer carries a JSON block after "${anchor}"`);
  }
  return JSON.parse(text.slice(fence + 8, close)) as T;
};
