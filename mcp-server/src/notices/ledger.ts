import { FILES } from '@/config';
import { nowISO, todayDate } from '@/shared/date';
import { writeJsonAtomic } from '@/shared/utils';
import { readFileSync } from 'node:fs';

export const OUTCOMES = ['acted', 'snoozed'] as const;
export type NoticeOutcomeKind = (typeof OUTCOMES)[number];

export interface NoticeOutcome {
  acted: number;
  snoozed: number;
  /** Snoozes since the last time the operator acted on it. */
  streak: number;
  lastAt: string;
}

/**
 * What the operator did with each notice, shared by every surface that shows one.
 */
export interface NoticeLedger {
  outcomes: Record<string, NoticeOutcome>;
  /** A notice snoozed through this local date stays hidden until the next one. */
  snoozedThrough: Record<string, string>;
}

const isRecord = (data: unknown): data is Record<string, unknown> => typeof data === 'object' && data !== null;

export const readLedger = (): NoticeLedger => {
  try {
    const data: unknown = JSON.parse(readFileSync(FILES.NOTICES, 'utf-8'));
    if (!isRecord(data)) {
      return { outcomes: {}, snoozedThrough: {} };
    }
    return {
      outcomes: isRecord(data.outcomes) ? (data.outcomes as NoticeLedger['outcomes']) : {},
      snoozedThrough: isRecord(data.snoozedThrough) ? (data.snoozedThrough as NoticeLedger['snoozedThrough']) : {}
    };
  } catch {
    return { outcomes: {}, snoozedThrough: {} };
  }
};

/**
 * Acting resets the snooze streak and lifts a snooze; snoozing hides the notice for the rest of today.
 */
export const recordOutcome = (id: string, outcome: NoticeOutcomeKind, now: Date = new Date()): NoticeOutcome => {
  const ledger = readLedger();
  const prior = ledger.outcomes[id] ?? { acted: 0, snoozed: 0, streak: 0, lastAt: '' };
  const isActed = outcome === 'acted';
  const next: NoticeOutcome = {
    acted: prior.acted + (isActed ? 1 : 0),
    snoozed: prior.snoozed + (isActed ? 0 : 1),
    streak: isActed ? 0 : prior.streak + 1,
    lastAt: nowISO(now)
  };
  const otherSnoozes = Object.fromEntries(Object.entries(ledger.snoozedThrough).filter(([key]) => key !== id));
  writeJsonAtomic(FILES.NOTICES, {
    outcomes: { ...ledger.outcomes, [id]: next },
    snoozedThrough: isActed ? otherSnoozes : { ...otherSnoozes, [id]: todayDate(now) }
  });
  return next;
};
