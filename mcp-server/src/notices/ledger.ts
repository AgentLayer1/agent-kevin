import { FILES, PLUGIN_VERSION } from '@/config';
import { todayDate } from '@/shared/date';
import { isRecord } from '@/shared/json-block';
import { writeJsonAtomic } from '@/shared/utils';
import { readFileSync } from 'node:fs';

export const OUTCOMES = ['acted', 'snoozed'] as const;

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the operator did with each notice, shared by every surface that shows one.
 */
export interface NoticeLedger {
  /** Snoozes in a row since the operator last acted on each notice. */
  streaks: Record<string, number>;
  /** A notice snoozed through this local date stays hidden until the next one. */
  snoozedThrough: Record<string, string>;
  /** The plugin version and local date the prompt row last fetched notices to draw. */
  row?: { version: string; date: string };
}

const isStreak = (data: unknown): data is number => Number.isInteger(data) && Number(data) >= 0;
const isLocalDate = (data: unknown): data is string => typeof data === 'string' && LOCAL_DATE.test(data);

// A hand-edited value of the wrong type is dropped, never obeyed: an object compared as a date would hide a notice for good.
const entriesOf = <T>(data: unknown, keep: (item: unknown) => item is T): Record<string, T> =>
  isRecord(data)
    ? Object.fromEntries(Object.entries(data).filter((entry): entry is [string, T] => keep(entry[1])))
    : {};

export const readLedger = (): NoticeLedger => {
  try {
    const data: unknown = JSON.parse(readFileSync(FILES.NOTICES, 'utf-8'));
    const root = isRecord(data) ? data : {};
    const row = isRecord(root.row) ? root.row : {};
    return {
      streaks: entriesOf(root.streaks, isStreak),
      snoozedThrough: entriesOf(root.snoozedThrough, isLocalDate),
      ...(typeof row.version === 'string' && isLocalDate(row.date)
        ? { row: { version: row.version, date: row.date } }
        : {})
    };
  } catch {
    return { streaks: {}, snoozedThrough: {} };
  }
};

/**
 * Acting resets the streak and lifts a snooze; snoozing hides the notice for the rest of today.
 */
export const recordOutcome = (id: string, outcome: (typeof OUTCOMES)[number]): NoticeLedger => {
  const ledger = readLedger();
  const isActed = outcome === 'acted';
  const otherSnoozes = Object.fromEntries(Object.entries(ledger.snoozedThrough).filter(([key]) => key !== id));
  const next: NoticeLedger = {
    ...ledger,
    streaks: { ...ledger.streaks, [id]: isActed ? 0 : (ledger.streaks[id] ?? 0) + 1 },
    snoozedThrough: isActed ? otherSnoozes : { ...otherSnoozes, [id]: todayDate() }
  };
  writeJsonAtomic(FILES.NOTICES, next);
  return next;
};

/**
 * Records that the prompt row is drawing notices, which lets the terminal banner leave them to it.
 */
export const stampRow = (): void =>
  writeJsonAtomic(FILES.NOTICES, { ...readLedger(), row: { version: PLUGIN_VERSION, date: todayDate() } });
