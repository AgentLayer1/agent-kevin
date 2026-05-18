import { FOLDERS, TIMEZONE } from '@/config';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'fs';
import { dirname, relative } from 'path';

// ── Path helpers ──────────────────────────────────────────────────────

/**
 * Render a path as repo-root-relative so user-facing output never leaks
 * `/Users/<name>/Documents/...` absolute paths. Paths already outside the
 * repo root are returned unchanged — better than producing a `../../foo`
 * trail.
 */
export function repoRelative(absolutePath: string): string {
  const rel = relative(FOLDERS.ROOT, absolutePath);
  return rel.startsWith('..') || rel === '' ? absolutePath : rel;
}

// ── Time helpers ──────────────────────────────────────────────────────
// All timestamps in local TIMEZONE for human readability. The explicit
// offset on nowISO() keeps it unambiguous without relying on the reader's
// clock.

/**
 * ISO-8601 offset string (e.g. "+08:00", "-05:00", "+00:00") for `TIMEZONE`
 * at the given instant. Honours DST by computing per-date.
 */
export function offsetFor(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, timeZoneName: 'longOffset' }).formatToParts(date);
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
export function nowISO(): string {
  const d = new Date();
  return d.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T') + offsetFor(d);
}

/** YYYY-MM-DD in local time. */
export function todayDate(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
}

/** YYYY-MM-DD `n` days ago in local time. */
export function daysAgoDate(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
}

/** HH:MM in local time (24-hour). */
export function nowTime(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
}

// ── Filesystem helpers ────────────────────────────────────────────────

/**
 * Atomic write: serialise to a sibling `.tmp` file, then rename. A crash
 * between write and rename leaves the previous file intact.
 */
export function writeFileAtomic(path: string, content: string | Uint8Array, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, content);
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, path);
}

/** Atomic JSON write — thin wrapper over `writeFileAtomic`. */
export function writeJsonAtomic(path: string, value: unknown, mode?: number): void {
  writeFileAtomic(path, JSON.stringify(value, null, 2), mode);
}
