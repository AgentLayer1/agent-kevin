/**
 * Memory pruning — deletes daily memory files older than KNOWLEDGE.MEMORY_PRUNE_DAYS.
 */

import { FOLDERS, KNOWLEDGE, TIMEZONE } from '@/config';
import { log as baseLog } from '@/shared/log';
import { readFile, readdir, unlink, writeFile } from 'fs/promises';
import { resolve } from 'path';

const log = baseLog.knowledge.with('prune');

export async function pruneMemory(): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KNOWLEDGE.MEMORY_PRUNE_DAYS);
  const cutoffStr = cutoff.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });

  let entries: string[];
  try {
    entries = await readdir(FOLDERS.MEMORY);
  } catch {
    return;
  }

  const toDelete = entries.filter((f) => {
    if (f === 'index.md') return false;
    const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})/);
    return dateMatch && dateMatch[1] < cutoffStr;
  });

  if (toDelete.length === 0) {
    log.info('Memory prune: nothing to prune');
    return;
  }

  for (const f of toDelete) {
    await unlink(resolve(FOLDERS.MEMORY, f));
  }

  const prunedDates = toDelete
    .map((f) => f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1])
    .filter((d): d is string => Boolean(d));
  const scrubbed = await scrubManifestEntries(prunedDates);

  const scrubMsg = scrubbed > 0 ? `; scrubbed ${scrubbed} dangling [[memory/…]] bullet(s) from index.md` : '';
  log.info(`Memory prune: deleted ${toDelete.length} file(s) older than ${cutoffStr} (${toDelete.join(', ')})${scrubMsg}`);
}

/**
 * Remove `- [[memory/<date>]] — …` manifest bullets from memory/index.md when their
 * target file has just been pruned. Prevents dangling-link lint errors. Scoped to
 * bullet lines (`^[ \t]*-[ \t]*[[memory/<date>]]`) — leaves mid-prose references
 * alone so substantive paragraphs aren't gutted.
 */
async function scrubManifestEntries(dates: string[]): Promise<number> {
  if (dates.length === 0) return 0;
  const indexPath = resolve(FOLDERS.MEMORY, 'index.md');

  let content: string;
  try {
    content = await readFile(indexPath, 'utf-8');
  } catch {
    return 0;
  }

  const escaped = dates.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`^[ \\t]*-[ \\t]*\\[\\[memory/(?:${escaped})(?:\\|[^\\]]*)?\\]\\].*\\r?\\n?`, 'gm');

  const matches = content.match(re);
  if (!matches || matches.length === 0) return 0;

  await writeFile(indexPath, content.replace(re, ''), 'utf-8');
  return matches.length;
}
