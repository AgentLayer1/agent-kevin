import { toLf } from '../../../mcp-server/src/shared/text';

const OPEN = '```json\n';

export const fencedJsonAfter = <T>(markdown: string, anchor: string): T => {
  // Git for Windows checks text out with CRLF by default, and a checkout made before
  // .gitattributes pinned LF keeps it until git rewrites the file.
  const text = toLf(markdown);
  const at = text.indexOf(anchor);
  const fence = text.indexOf(OPEN, at);
  const close = text.indexOf('\n```', fence + OPEN.length);
  if (at === -1 || fence === -1 || close === -1) {
    throw new Error(`init SKILL.md no longer carries a JSON block after "${anchor}"`);
  }
  return JSON.parse(text.slice(fence + OPEN.length, close)) as T;
};
