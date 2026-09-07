/**
 * The static context stack for a harness that cannot `@-import` it — today,
 * Codex. Claude Code loads these files through the `.claude/CLAUDE.md` bridge;
 * Codex loads `AGENTS.md` natively and nothing else, and caps each SessionStart
 * hook's output at roughly 10,000 characters (head and tail kept, middle
 * dropped). So the stack is delivered as N hook entries, each printing one
 * slice, chunked on line boundaries under that cap.
 */
import { FILES, FOLDERS } from '@/config';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/** Under Codex's ~10,000-character cap, with room for the slice preamble. */
export const SLICE_CHARS = 9_500;

/** Every stack file that exists, each introduced by its home-relative path, followed by the dynamic lane. */
export const buildStaticStack = (dynamicContext: string): string => {
  const parts = [
    FILES.SOUL,
    FILES.IDENTITY,
    FILES.USER,
    FILES.KNOWLEDGE,
    FILES.MEMORY,
    resolve(FOLDERS.PROJECTS, 'TASKS.md')
  ]
    .filter((path) => existsSync(path))
    .map((path) => {
      const rel = relative(FOLDERS.HOME, path).split(sep).join('/');
      return `<!-- file: ${rel} -->\n${readFileSync(path, 'utf-8').trimEnd()}`;
    });
  if (dynamicContext.trim()) parts.push(`<!-- session context (dynamic lane) -->\n${dynamicContext.trimEnd()}`);
  return parts.join('\n\n');
};

/** Chunk on line boundaries so no slice exceeds `limit`; a single over-long line becomes its own slice. */
export const sliceText = (text: string, limit: number): string[] => {
  const slices: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit && current) {
      slices.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) slices.push(current);
  return slices;
};

export interface SliceRequest {
  /** 1-based slice index this hook entry is responsible for. */
  index: number;
  /** How many hook entries are registered; slices beyond this are undeliverable. */
  total: number;
}

/**
 * The text hook entry `index` of `total` should print: its slice with a
 * one-line preamble, nothing when the stack has fewer slices than entries, and
 * a warning appended to the last entry when the stack has more.
 */
export const renderSlice = (stack: string, request: SliceRequest): string => {
  const slices = sliceText(stack, SLICE_CHARS);
  const count = slices.length;
  if (request.index < 1 || request.index > Math.min(count, request.total)) return '';
  const body = slices[request.index - 1];
  const preamble = `<!-- kevin static context · slice ${request.index}/${count} · delivered by the plugin's SessionStart hooks because this harness has no @-import -->`;
  const undelivered = request.index === request.total && count > request.total ? count - request.total : 0;
  const warning = undelivered
    ? `\n\n<!-- ⚠️ kevin: ${undelivered} more slice(s) of static context were not delivered. Raise the number of session-start entries in .codex/hooks.json (${request.total} registered, ${count} needed). -->`
    : '';
  return `${preamble}\n\n${body}${warning}\n`;
};
