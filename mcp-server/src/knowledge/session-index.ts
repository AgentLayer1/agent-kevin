/**
 * Session catalog (`raw/sessions/index.json`) — the identity layer that lets
 * capture resume a session across days and lets compile tell a continuation
 * from a new memory.
 *
 * The index is a *cache* over the authoritative day-files: every block header
 * encodes `(sessionId, date, turn-range)` (see session-format.ts), so a lost
 * or corrupt index rebuilds by scanning headers. Capture stays correct even
 * if `.kevin`/the index is wiped — worst case is a one-time re-anchor.
 *
 * Pure logic (`diffTurns`, `recordCapture`) is separated from I/O
 * (`loadIndex`, `saveIndex`, `rebuildFromDayFiles`) so the dedup maths is
 * unit-testable without touching disk.
 */
import { FILES, FOLDERS } from '@/config';
import { hashBuffer } from '@/knowledge/utils';
import { parseEntryHeaders } from '@/knowledge/session-format';
import { log as baseLog } from '@/shared/log';
import type { SessionIndex, SessionRecord, TranscriptTurn } from '@/shared/types';
import { writeJsonAtomic } from '@/shared/utils';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const log = baseLog.session.with('index');

const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

const emptyIndex = (): SessionIndex => ({ schema: 1, sessions: {} });

/** Fingerprint a turn's text — short hash used as the cursor anchor guard. */
export const fingerprintTurn = (turn: TranscriptTurn): string => hashBuffer(turn.text);

// ── Pure: turn diff (the dedup heart) ────────────────────────────────

export interface TurnDiff {
  /** turns not yet written to raw for this session */
  newTurns: TranscriptTurn[];
  /** 1-based turn number of the first new turn */
  from: number;
  /** 1-based turn number of the last new turn (= allTurns.length) */
  to: number;
  /** true when the cursor anchor no longer matches — transcript was rewritten */
  reanchored: boolean;
}

/**
 * Given every turn currently in the transcript and the prior index record,
 * return only the turns appended since the last capture. The high-water mark
 * `captured_turns` is the count of turns already written; the anchor turn
 * (index `captured_turns - 1`) is fingerprint-checked so a rewritten/compacted
 * transcript is detected rather than silently mis-sliced.
 */
export function diffTurns(allTurns: TranscriptTurn[], prior: SessionRecord | null): TurnDiff {
  const total = allTurns.length;
  const cursor = prior?.captured_turns ?? 0;

  if (cursor <= 0) {
    return { newTurns: allTurns, from: 1, to: total, reanchored: false };
  }
  if (total <= cursor) {
    // Nothing new (or transcript shrank — treat as nothing new, never negative).
    return { newTurns: [], from: cursor + 1, to: cursor, reanchored: false };
  }

  const anchorOk = fingerprintTurn(allTurns[cursor - 1]) === prior?.last_turn_fp;
  return {
    newTurns: allTurns.slice(cursor),
    from: cursor + 1,
    to: total,
    reanchored: !anchorOk
  };
}

// ── Pure: record a capture into the index ────────────────────────────

export interface CaptureEvent {
  sessionId: string;
  date: string;
  cwd: string;
  from: number;
  to: number;
  lastTurnFp: string;
  /** used only when creating a fresh record */
  briefingStub: string;
}

/** Merge a freshly-written block into a session's coverage list, coalescing
 *  contiguous same-day ranges (e.g. a Pre-Compact 1–40 then a Session 41–55). */
const mergeBlock = (blocks: SessionRecord['blocks'], date: string, from: number, to: number) => {
  const last = blocks[blocks.length - 1];
  if (last && last.date === date && from === last.to + 1) {
    return [...blocks.slice(0, -1), { date, from: last.from, to }];
  }
  return [...blocks, { date, from, to }];
};

/** Return a new index with `ev` folded in (create-or-extend the session). */
export function recordCapture(index: SessionIndex, ev: CaptureEvent): SessionIndex {
  const existing = index.sessions[ev.sessionId];
  const record: SessionRecord = existing
    ? {
        ...existing,
        last_seen: ev.date,
        cwd: ev.cwd,
        captured_turns: ev.to,
        last_turn_fp: ev.lastTurnFp,
        blocks: mergeBlock(existing.blocks, ev.date, ev.from, ev.to)
      }
    : {
        first_seen: ev.date,
        last_seen: ev.date,
        cwd: ev.cwd,
        captured_turns: ev.to,
        last_turn_fp: ev.lastTurnFp,
        briefing: ev.briefingStub,
        blocks: [{ date: ev.date, from: ev.from, to: ev.to }]
      };
  return { schema: index.schema, sessions: { ...index.sessions, [ev.sessionId]: record } };
}

// ── I/O ──────────────────────────────────────────────────────────────

async function listDayFiles(): Promise<string[]> {
  try {
    const entries = await readdir(FOLDERS.SESSIONS);
    return entries
      .filter((f) => DAY_FILE_RE.test(f))
      .sort()
      .map((f) => resolve(FOLDERS.SESSIONS, f));
  } catch {
    return [];
  }
}

/**
 * Rebuild the index from day-file headers. Used when the index file is missing
 * or unparseable. `last_turn_fp`/`briefing` can't be recovered from headers
 * (turn text isn't stored), so they come back empty — the next capture
 * re-anchors once and heals. Turn coverage, spans and cwd are exact.
 */
export async function rebuildFromDayFiles(): Promise<SessionIndex> {
  const files = await listDayFiles();
  let index = emptyIndex();
  for (const file of files) {
    const content = await readFile(file, 'utf-8').catch(() => '');
    for (const header of parseEntryHeaders(content)) {
      index = recordCapture(index, {
        sessionId: header.idShort,
        date: header.date,
        cwd: header.source,
        from: header.from,
        to: header.to,
        lastTurnFp: '',
        briefingStub: ''
      });
    }
  }
  return index;
}

/** Load the index, rebuilding from headers if the file is corrupt. */
export async function loadIndex(): Promise<SessionIndex> {
  if (!existsSync(FILES.SESSION_INDEX)) return emptyIndex();
  try {
    const parsed = JSON.parse(await readFile(FILES.SESSION_INDEX, 'utf-8')) as Partial<SessionIndex>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.sessions !== 'object') {
      throw new Error('malformed session index');
    }
    return { schema: parsed.schema ?? 1, sessions: parsed.sessions ?? {} };
  } catch (err) {
    log.warn('session index unparseable — rebuilding from day-file headers', err);
    return rebuildFromDayFiles();
  }
}

export async function saveIndex(index: SessionIndex): Promise<void> {
  writeJsonAtomic(FILES.SESSION_INDEX, index);
}
