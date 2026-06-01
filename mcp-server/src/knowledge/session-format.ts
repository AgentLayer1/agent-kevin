/**
 * Single source of truth for the session-log entry format. The writer
 * (`scripts/session-capture.ts`) and readers (`chunk.ts`, `context.ts`)
 * both import from here, so any change to the separator or header shape
 * propagates to everyone that needs to stay in sync.
 */

/** Literal byte sequence the writer emits between entries. */
export const ENTRY_SEPARATOR = '\n\n---\n\n';

const ENTRY_HEADER_PATTERN = '### (?:Session|Pre-Compact) \\(';
const SESSION_HEADER_PATTERN = '### Session \\(\\d{2}:\\d{2}\\) ';
const ESCAPED_SEPARATOR = ENTRY_SEPARATOR.replace(/\n/g, '\\n');

/** Matches an entry header opening (Session or Pre-Compact) at line start. */
export const ENTRY_HEADER_RE = new RegExp(`^${ENTRY_HEADER_PATTERN}`, 'm');

/**
 * Splits a body into entry-aligned chunks. Requires either start-of-body or
 * the literal `ENTRY_SEPARATOR` immediately before each header — keeps
 * headers inside fenced code blocks from triggering false splits.
 */
export const ENTRY_SPLIT_RE = new RegExp(`(?<=^|${ESCAPED_SEPARATOR})(?=${ENTRY_HEADER_PATTERN})`);

/**
 * Locates each `ENTRY_SEPARATOR` immediately followed by a Session header
 * (not Pre-Compact). Consume via `matchAll` to avoid the shared-state hazard
 * that comes with `/g` + `exec`.
 */
export const SESSION_BLOCK_SEPARATOR_RE = new RegExp(`${ESCAPED_SEPARATOR}(?=${SESSION_HEADER_PATTERN})`, 'g');

/** Matches a Session header at line start — fallback when no separators exist. */
export const FIRST_SESSION_HEADER_RE = new RegExp(`^${SESSION_HEADER_PATTERN}`, 'm');

/** Matches a trailing `ENTRY_SEPARATOR` + whitespace at end-of-block. */
export const TRAILING_SEPARATOR_RE = new RegExp(`${ESCAPED_SEPARATOR}\\s*$`);

// ── Entry header: format + parse ─────────────────────────────────────
//
// Header anatomy (the `### ${heading} (${time}) ` prefix is load-bearing —
// the SessionStart tail regexes above key off it, so date / turn-range /
// markers are appended only as suffix fields):
//
//   ### Session (11:02) [abc12345] · 2026-06-03 · ~/Kevin · turns 9–15 · ↩ continues 2026-06-01
//
// The turn range makes every block self-describing — capture and compile
// can reconstruct the whole session index from headers alone.

/** En-dash used in `turns FROM–TO`. Kept as a constant so writer and parser stay in lockstep. */
const TURN_DASH = '–';

export interface EntryHeaderFields {
  /** 'Session' | 'Pre-Compact' */
  heading: string;
  /** HH:MM */
  time: string;
  /** short session id (first 8 chars) */
  idShort: string;
  /** YYYY-MM-DD this block was written */
  date: string;
  /** home-relative cwd */
  source: string;
  /** first turn number in this block (1-based, inclusive) */
  from: number;
  /** last turn number in this block (inclusive) */
  to: number;
  /** when set, this block continues a session first seen on this earlier date */
  continues?: string;
  /** when true, the cursor was re-anchored after a transcript rewrite */
  reanchored?: boolean;
}

/** Render an entry header line (no trailing newline). */
export function formatEntryHeader(fields: EntryHeaderFields): string {
  const parts = [
    `### ${fields.heading} (${fields.time}) [${fields.idShort}]`,
    fields.date,
    fields.source,
    `turns ${fields.from}${TURN_DASH}${fields.to}`
  ];
  if (fields.continues) parts.push(`↩ continues ${fields.continues}`);
  if (fields.reanchored) parts.push('⚠ re-anchored');
  return parts.join(' · ');
}

/** One parsed header — the subset needed to rebuild the session index. */
export interface ParsedEntryHeader {
  heading: string;
  idShort: string;
  date: string;
  source: string;
  from: number;
  to: number;
}

const PARSE_HEADER_RE = new RegExp(
  `^### (Session|Pre-Compact) \\(\\d{2}:\\d{2}\\) \\[([0-9a-fA-F]+)\\] · (\\d{4}-\\d{2}-\\d{2}) · (.+?) · turns (\\d+)${TURN_DASH}(\\d+)`,
  'gm'
);

/**
 * Extract every parseable entry header from a day-file's content. Headers that
 * predate the turn-range format (no `· turns N–M`) are skipped — they can't be
 * placed on the cursor timeline and the index treats their sessions as absent.
 */
export function parseEntryHeaders(content: string): ParsedEntryHeader[] {
  const out: ParsedEntryHeader[] = [];
  for (const match of content.matchAll(PARSE_HEADER_RE)) {
    out.push({
      heading: match[1],
      idShort: match[2],
      date: match[3],
      source: match[4],
      from: parseInt(match[5], 10),
      to: parseInt(match[6], 10)
    });
  }
  return out;
}
