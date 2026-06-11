import { FOLDERS } from '@/config';
import { createLogger } from '@/shared/log';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { discoverProjects } from './scan';

const log = createLogger('tasks.link');

/**
 * Build a map from task ID (e.g. `mb-014`) to the file's basename without
 * extension (e.g. `mb-014-mdec-pre-incorporation-compliance-checklist-setup-`).
 * The basename is what Obsidian's wikilink resolver will match.
 */
export const buildTaskMap = (): Map<string, string> => {
  const map = new Map<string, string>();
  const collisions = new Map<string, string[]>();

  for (const project of discoverProjects()) {
    const dir = join(FOLDERS.PROJECTS, project, 'tasks');
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md') || file.startsWith('.')) continue;
      const match = file.match(/^([a-z]+-\d+)/);
      if (!match) continue;
      const id = match[1];
      const stem = file.replace(/\.md$/, '');
      if (map.has(id) && map.get(id) !== stem) {
        const list = collisions.get(id) ?? [map.get(id)!];
        list.push(stem);
        collisions.set(id, list);
      } else {
        map.set(id, stem);
      }
    }
  }

  for (const [id, files] of collisions) {
    log.warn(`Task ID ${id} has multiple files; skipping rewrite for it: ${files.join(', ')}`);
    map.delete(id);
  }

  return map;
};

/**
 * Rewrite bare task-ID tokens in `text` to aliased wikilinks. Pure function:
 * no I/O, deterministic given inputs.
 *
 * Skips:
 * - YAML frontmatter (top-of-file `---` block) — keeps `depends_on: [mb-014]`
 *   as bare IDs, the canonical metadata format.
 * - Fenced code blocks (```)
 * - Inline code (`...`)
 * - Existing wikilinks (`[[...]]`)
 * - Markdown link syntax (`[text](url)`)
 * - Raw http(s) URLs
 *
 * Word-boundary matched, so `lo-013` inside `lo-0135` is left alone.
 */
export const rewriteLinks = (text: string, taskMap: Map<string, string>): string => {
  if (taskMap.size === 0) return text;

  // Peel off YAML frontmatter so we don't touch metadata.
  const fmMatch = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const frontmatter = fmMatch ? fmMatch[0] : '';
  const body = text.slice(frontmatter.length);

  const prefixes = Array.from(new Set(Array.from(taskMap.keys(), (id) => id.split('-')[0])));
  const prefixGroup = `(?:${prefixes.join('|')})-\\d+`;
  // Match either a single-bracketed ID `[<id>]` (consume brackets — common
  // shorthand in TASKS.md) or a bare ID with word boundaries.
  const idRegex = new RegExp(`\\[(${prefixGroup})\\]|\\b(${prefixGroup})\\b`, 'g');

  const wikilinkFor = (id: string): string => {
    const stem = taskMap.get(id);
    if (!stem) return id;
    // If the stem already equals the bare ID (e.g. file is `lo-013.md`),
    // an alias is unnecessary noise — emit `[[lo-013]]` instead.
    return stem === id ? `[[${id}]]` : `[[${stem}|${id}]]`;
  };

  const rewriteFree = (chunk: string): string =>
    chunk.replace(idRegex, (full, bracketed, bare) => {
      const id = bracketed ?? bare;
      const link = wikilinkFor(id);
      // No mapping → leave the original token (including its brackets) alone.
      if (link === id) return full;
      return link;
    });

  // Tokenize: match protected regions OR free prose. Use a single pass over
  // the body so we never rewrite inside a span we shouldn't.
  // Order matters: `[...](...)` before `\[\[...\]\]` so the inline link form
  // (which contains `]`) wins over the wikilink form when both could match.
  const protectedPattern =
    /```[\s\S]*?```|`[^`\n]+`|\[[^\]\n]*\]\([^)\n]*\)|\[[^\]\n]*\]:|\[\[[^\]\n]*\]\]|https?:\/\/\S+/g;

  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = protectedPattern.exec(body)) !== null) {
    out += rewriteFree(body.slice(lastIndex, match.index));
    out += match[0];
    lastIndex = match.index + match[0].length;
  }
  out += rewriteFree(body.slice(lastIndex));

  return frontmatter + out;
};
