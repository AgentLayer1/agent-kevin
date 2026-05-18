/**
 * Normalize cross-references in the wiki TO Obsidian-style wikilinks
 * (`[[path/to/article(#anchor)?(|alias)?]]`). The Karpathy convention is that
 * wikilinks are the canonical form for in-wiki links — they render natively
 * in Obsidian, survive moves better than relative paths, and read as
 * intent-not-resolution. Project READMEs live outside the wiki and keep
 * standard markdown links.
 *
 * Coverage:
 *   - Markdown links `[Display](path.md(#anchor)?)` pointing at any file
 *     under `FOLDERS.KNOWLEDGE` get converted to `[[wiki-rel-path(#anchor)?(|Display)?]]`.
 *     Alias is omitted when Display matches the target's title.
 *   - Links pointing outside the wiki (projects/, external URLs) are
 *     preserved verbatim.
 *   - Wikilinks already in canonical form stay as-is.
 *   - Links inside code blocks/inline code/reference defs are skipped.
 *
 * Authors can write either form; compile + lint --fix run this so on-disk
 * state converges on wikilinks.
 */

import { FILES, FOLDERS } from '@/config';
import { readFile, writeFile } from 'fs/promises';
import { dirname, relative, resolve } from 'path';
import { listWikiArticles, splitFrontmatter } from './utils';

export interface LinkInfo {
  /** Display text for the link. Frontmatter `title:` > first H1 > slug. */
  displayName: string;
  /** Absolute path to the target file. */
  absolutePath: string;
}

/** Map keyed by wiki-relative path without `.md` (e.g. `concepts/flywheel-model`). */
export type WikilinkMap = Map<string, LinkInfo>;

/**
 * Match a markdown link. Captures:
 *   1. text  — display text (can be empty)
 *   2. url   — link target (file path or URL)
 *
 * Reference-style links `[label]:` and image links `![alt](url)` excluded.
 */
const MARKDOWN_LINK_RE = /(?<!!)\[([^\]\n]*)\]\(([^)\n]+)\)/g;

/**
 * Protected regions: code blocks, inline code, reference link defs, raw URLs.
 * Order: longer/more-specific patterns first.
 */
const PROTECTED_RE = /```[\s\S]*?```|`[^`\n]+`|\[[^\]\n]*\]:|https?:\/\/\S+/g;

/**
 * Resolve a markdown-link URL relative to the source file. Returns the
 * wiki-relative path (without `.md`) if the resolved target is inside
 * `FOLDERS.KNOWLEDGE`, otherwise null.
 */
function urlToWikiKey(url: string, fromDir: string): { key: string; anchor: string } | null {
  // Drop fragment/anchor before resolution; tack it back on the wiki key.
  const [pathPart, anchor = ''] = url.split('#');
  if (!pathPart) return null;
  if (/^[a-z]+:\/\//i.test(pathPart)) return null;        // external URL
  if (!pathPart.endsWith('.md')) return null;             // not a markdown file
  const abs = resolve(fromDir, pathPart);
  const rel = relative(FOLDERS.KNOWLEDGE, abs);
  if (rel.startsWith('..') || rel.startsWith('/')) return null;  // outside wiki
  return { key: rel.replace(/\.md$/, ''), anchor };
}

/**
 * Rewrite markdown links in `content` to wikilinks where the target is a
 * wiki article. Returns the rewritten content (unchanged if nothing matched).
 *
 * Idempotent: running twice yields the same output (canonical wikilinks
 * skip the regex; already-resolved markdown stays markdown when target is
 * outside the wiki).
 */
export function rewriteWikilinks(content: string, fromFile: string, links: WikilinkMap): string {
  if (links.size === 0) return content;

  const { frontmatter, body } = splitFrontmatter(content);
  const fromDir = dirname(fromFile);

  const replaceInProse = (chunk: string): string =>
    chunk.replace(MARKDOWN_LINK_RE, (match, text: string, url: string) => {
      const resolved = urlToWikiKey(url, fromDir);
      if (!resolved) return match;
      const info = links.get(resolved.key);
      if (!info) return match;
      const target = resolved.anchor ? `${resolved.key}#${resolved.anchor}` : resolved.key;
      const display = text.trim();
      return !display || display === info.displayName ? `[[${target}]]` : `[[${target}|${display}]]`;
    });

  PROTECTED_RE.lastIndex = 0;
  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PROTECTED_RE.exec(body)) !== null) {
    out += replaceInProse(body.slice(lastIndex, match.index));
    out += match[0];
    lastIndex = match.index + match[0].length;
  }
  out += replaceInProse(body.slice(lastIndex));

  return frontmatter + out;
}

async function readLinkInfo(filePath: string, fallback: string): Promise<LinkInfo | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const titleFromFm = fmMatch?.[1].match(/^title:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
  if (titleFromFm) return { displayName: titleFromFm, absolutePath: filePath };

  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const h1 = body.match(/^#\s+(.+)$/m)?.[1].trim();
  return { displayName: h1 ?? fallback, absolutePath: filePath };
}

/**
 * Build the wiki-relative-path → LinkInfo lookup table for every wiki article
 * (including transient `memory/YYYY-MM-DD.md` files so daily-memory references
 * resolve correctly).
 */
export async function loadLinkTargets(): Promise<WikilinkMap> {
  const map: WikilinkMap = new Map();
  const articlePaths = await listWikiArticles();
  for (const articlePath of articlePaths) {
    const rel = relative(FOLDERS.KNOWLEDGE, articlePath).replace(/\.md$/, '');
    const fallback = rel.split('/').pop() ?? rel;
    const info = await readLinkInfo(articlePath, fallback);
    if (info) map.set(rel, info);
  }
  return map;
}

/**
 * Normalize cross-references to wikilinks across every wiki article and
 * `knowledge/index.md`. Idempotent — re-running on already-canonical content
 * is a no-op. Returns absolute paths of files modified.
 */
export async function rewriteAllWikilinks(): Promise<string[]> {
  const links = await loadLinkTargets();
  if (links.size === 0) return [];

  const targets = [...(await listWikiArticles()), FILES.KNOWLEDGE];
  const modified: string[] = [];

  for (const path of targets) {
    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch {
      continue;
    }
    const rewritten = rewriteWikilinks(content, path, links);
    if (rewritten !== content) {
      await writeFile(path, rewritten, 'utf-8');
      modified.push(path);
    }
  }
  return modified;
}
