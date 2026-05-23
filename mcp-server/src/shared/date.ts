import { TIMEZONE } from '@/config';

// All timestamps in local TIMEZONE for human readability. The explicit offset
// on nowISO() keeps it unambiguous without relying on the reader's clock.

/**
 * ISO-8601 offset string (e.g. "+08:00", "-05:00", "+00:00") for `TIMEZONE`
 * at the given instant. Honours DST by computing per-date.
 */
export function offsetFor(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    timeZoneName: 'longOffset'
  }).formatToParts(date);
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  // Intl emits "GMT+08:00", "GMT-05:00", or bare "GMT" for UTC.
  const match = tzName.match(/GMT([+-]\d{1,2}(?::?\d{2})?)?/);
  if (!match || !match[1]) return '+00:00';
  const raw = match[1];
  if (raw.includes(':')) {
    const [sign, rest] = [raw[0], raw.slice(1)];
    const [h, m] = rest.split(':');
    return `${sign}${h.padStart(2, '0')}:${m}`;
  }
  const sign = raw[0];
  const digits = raw.slice(1);
  return `${sign}${digits.slice(0, 2).padStart(2, '0')}:${digits.slice(2).padEnd(2, '0')}`;
}

/** ISO-8601 timestamp in local time with explicit offset. */
export function nowISO(date: Date = new Date()): string {
  return date.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T') + offsetFor(date);
}

/** YYYY-MM-DD in local time. */
export function todayDate(date: Date = new Date()): string {
  return date.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
}

/** YYYY-MM-DD `n` days ago in local time. */
export function daysAgoDate(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', {
    timeZone: TIMEZONE
  });
}

/** HH:MM in local time (24-hour, colon-separated). */
export function nowTime(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIMEZONE
  });
}

/** HHMM in local time (24-hour, no separator). Useful as a filename component. */
export function nowTimeCompact(date: Date = new Date()): string {
  return nowTime(date).replace(':', '');
}
