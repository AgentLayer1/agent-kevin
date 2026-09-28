import { todayDate } from '@/shared/date';

/**
 * A task's `horizon` is the period it is planned for, stored as the period itself
 * (`2026-09-28`, `2026-W40`, `2026-10`, or `later`), so a plan dates itself.
 */
export const HORIZON_SHORTHANDS = ['today', 'week', 'next-week', 'month', 'later'] as const;
export type HorizonShorthand = (typeof HORIZON_SHORTHANDS)[number];

export const HORIZON_BUCKETS = ['carried', 'today', 'week', 'month', 'later'] as const;
export type HorizonBucket = (typeof HORIZON_BUCKETS)[number];

export type Period = { kind: 'day' | 'week' | 'month'; start: string; end: string } | { kind: 'later' };

const DAY_MS = 86_400_000;

const toUtc = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const isRealDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date) && fromUtc(toUtc(date)) === date;

const mondayIndex = (ms: number): number => (new Date(ms).getUTCDay() + 6) % 7;

export const isoWeekOf = (date: string): string => {
  const ms = toUtc(date);
  const thursday = ms + (3 - mondayIndex(ms)) * DAY_MS;
  const isoYear = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(isoYear, 0, 1)) / DAY_MS / 7) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
};

const isoWeekStart = (isoYear: number, week: number): string => {
  const jan4 = Date.UTC(isoYear, 0, 4);
  return fromUtc(jan4 - mondayIndex(jan4) * DAY_MS + (week - 1) * 7 * DAY_MS);
};

const addDays = (date: string, days: number): string => fromUtc(toUtc(date) + days * DAY_MS);

const monthEnd = (month: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  return fromUtc(Date.UTC(year, monthNumber, 0));
};

export const parsePeriod = (value: string): Period | null => {
  if (value === 'later') {
    return { kind: 'later' };
  }
  if (isRealDate(value)) {
    return { kind: 'day', start: value, end: value };
  }
  const week = value.match(/^(\d{4})-W(\d{2})$/);
  if (week) {
    const start = isoWeekStart(Number(week[1]), Number(week[2]));
    return isoWeekOf(start) === value ? { kind: 'week', start, end: addDays(start, 6) } : null;
  }
  const month = value.match(/^(\d{4})-(\d{2})$/);
  if (month && Number(month[2]) >= 1 && Number(month[2]) <= 12) {
    return { kind: 'month', start: `${value}-01`, end: monthEnd(value) };
  }
  return null;
};

export const isHorizon = (value: string): boolean => parsePeriod(value) !== null;

/** Resolve a shorthand (`today`, `week`, `next-week`, `month`, `later`) or a literal period to the stored form; '' clears. */
export const normalizeHorizon = (input: string, today: string = todayDate()): string => {
  const value = input.trim();
  const resolved: Record<HorizonShorthand, string> = {
    today,
    week: isoWeekOf(today),
    'next-week': isoWeekOf(addDays(today, 7)),
    month: today.slice(0, 7),
    later: 'later'
  };
  const normalized = value in resolved ? resolved[value as HorizonShorthand] : value;
  if (normalized !== '' && !isHorizon(normalized)) {
    throw new Error(
      `Invalid horizon "${input}": use today, week, next-week, month, later, or a period like 2026-09-28, 2026-W40, 2026-10`
    );
  }
  return normalized;
};

/** Whether a horizon plans work inside the current week or month: a day or week that starts in it, or the month itself. */
export const horizonWithin = (value: string, span: 'week' | 'month', today: string = todayDate()): boolean => {
  const period = parsePeriod(value);
  if (!period || period.kind === 'later' || (span === 'week' && period.kind === 'month')) {
    return false;
  }
  const start = span === 'week' ? addDays(today, -mondayIndex(toUtc(today))) : `${today.slice(0, 7)}-01`;
  const end = span === 'week' ? addDays(start, 6) : monthEnd(today.slice(0, 7));
  return period.start >= start && period.start <= end;
};

/** Which focus lane a horizon falls in as of `today`; null when unset or unparseable. */
export const horizonBucket = (value: string, today: string = todayDate()): HorizonBucket | null => {
  const period = parsePeriod(value);
  if (!period) {
    return null;
  }
  if (period.kind === 'later') {
    return 'later';
  }
  if (period.end < today) {
    return 'carried';
  }
  if (period.start <= today) {
    return period.kind === 'day' ? 'today' : period.kind;
  }
  if (period.kind !== 'day') {
    return 'later';
  }
  if (period.start <= addDays(today, 6 - mondayIndex(toUtc(today)))) {
    return 'week';
  }
  return period.start <= monthEnd(today.slice(0, 7)) ? 'month' : 'later';
};
