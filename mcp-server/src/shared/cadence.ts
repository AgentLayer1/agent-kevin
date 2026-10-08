import { FILES } from '@/config';
import { nowISO } from '@/shared/date';
import { writeJsonAtomic } from '@/shared/utils';
import { readFileSync } from 'node:fs';

/**
 * The `cadence.json` watermarks runtime surfaces read. The goals keys belong to the sync skill's
 * cadence script and survive every write here.
 */
export interface Cadence {
  /** `pending` from init until the first session's welcome, then the date it ran. */
  welcome?: string;
  /** ISO timestamp of the last sync, which ages in hours on the dashboard and days in the sync notice. */
  sync?: string;
}

export const readCadence = (): Cadence => {
  try {
    return JSON.parse(readFileSync(FILES.CADENCE, 'utf-8'));
  } catch {
    return {};
  }
};

export const stampSync = (): void => writeJsonAtomic(FILES.CADENCE, { ...readCadence(), sync: nowISO() });
