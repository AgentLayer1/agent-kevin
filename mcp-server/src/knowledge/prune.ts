/**
 * Memory pruning — deletes daily memory files older than KNOWLEDGE.MEMORY_PRUNE_DAYS.
 */

import { FOLDERS, KNOWLEDGE, TIMEZONE } from '@/config';
import { log as baseLog } from '@/shared/log';
import { readdir, unlink } from 'fs/promises';
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

  log.info(`Memory prune: deleted ${toDelete.length} file(s) older than ${cutoffStr} (${toDelete.join(', ')})`);
}
