import { FILES } from '@/config';
import { todayDate } from '@/shared/date';
import { isRecord } from '@/shared/json-block';
import { writeJsonAtomic } from '@/shared/utils';
import { readFileSync } from 'node:fs';

export const OUTCOMES = ['acted', 'snoozed'] as const;

/**
 * What the operator did with each notice, shared by every surface that shows one.
 */
export interface NoticeLedger {
  /** Snoozes in a row since the operator last acted on each notice. */
  streaks: Record<string, number>;
  /** A notice snoozed through this local date stays hidden until the next one. */
  snoozedThrough: Record<string, string>;
}

export const readLedger = (): NoticeLedger => {
  try {
    const data: unknown = JSON.parse(readFileSync(FILES.NOTICES, 'utf-8'));
    const root = isRecord(data) ? data : {};
    return {
      streaks: isRecord(root.streaks) ? (root.streaks as NoticeLedger['streaks']) : {},
      snoozedThrough: isRecord(root.snoozedThrough) ? (root.snoozedThrough as NoticeLedger['snoozedThrough']) : {}
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
    streaks: { ...ledger.streaks, [id]: isActed ? 0 : (ledger.streaks[id] ?? 0) + 1 },
    snoozedThrough: isActed ? otherSnoozes : { ...otherSnoozes, [id]: todayDate() }
  };
  writeJsonAtomic(FILES.NOTICES, next);
  return next;
};
