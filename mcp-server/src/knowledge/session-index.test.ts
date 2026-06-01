import { describe, expect, test } from 'bun:test';
import { formatEntryHeader, parseEntryHeaders } from '@/knowledge/session-format';
import { diffTurns, fingerprintTurn, recordCapture } from '@/knowledge/session-index';
import type { SessionIndex, SessionRecord, TranscriptTurn } from '@/shared/types';

const turn = (role: 'user' | 'assistant', text: string): TranscriptTurn => ({ role, text });

/** A deterministic N-turn transcript: u1, a1, u2, a2, … */
const transcript = (n: number): TranscriptTurn[] =>
  Array.from({ length: n }, (_unused, i) =>
    turn(i % 2 === 0 ? 'user' : 'assistant', `turn ${i + 1}`)
  );

const recordFor = (turns: TranscriptTurn[], capturedTurns: number): SessionRecord => ({
  first_seen: '2026-06-01',
  last_seen: '2026-06-01',
  cwd: '~/Kevin',
  captured_turns: capturedTurns,
  last_turn_fp: fingerprintTurn(turns[capturedTurns - 1]),
  briefing: 'stub',
  blocks: [{ date: '2026-06-01', from: 1, to: capturedTurns }]
});

describe('diffTurns', () => {
  test('new session returns every turn from 1', () => {
    const turns = transcript(8);
    const diff = diffTurns(turns, null);
    expect(diff.from).toBe(1);
    expect(diff.to).toBe(8);
    expect(diff.newTurns).toHaveLength(8);
    expect(diff.reanchored).toBe(false);
  });

  test('empty transcript yields no new turns', () => {
    const diff = diffTurns([], null);
    expect(diff.newTurns).toHaveLength(0);
  });

  test('re-capture with no growth yields nothing (kills the double-dump)', () => {
    const turns = transcript(8);
    const prior = recordFor(turns, 8);
    const diff = diffTurns(turns, prior);
    expect(diff.newTurns).toHaveLength(0);
    expect(diff.reanchored).toBe(false);
  });

  test('resume slices only the appended turns', () => {
    const turns = transcript(15);
    const prior = recordFor(turns, 8);
    const diff = diffTurns(turns, prior);
    expect(diff.from).toBe(9);
    expect(diff.to).toBe(15);
    expect(diff.newTurns).toHaveLength(7);
    expect(diff.reanchored).toBe(false);
    expect(diff.newTurns[0].text).toBe('turn 9');
  });

  test('anchor fingerprint mismatch re-emits the whole session (no content loss)', () => {
    const turns = transcript(15);
    const prior = { ...recordFor(turns, 8), last_turn_fp: 'stale-does-not-match' };
    const diff = diffTurns(turns, prior);
    expect(diff.reanchored).toBe(true);
    expect(diff.from).toBe(1);
    expect(diff.newTurns).toHaveLength(15);
  });

  test('shrunken transcript never produces negative slice', () => {
    const turns = transcript(3);
    const prior = recordFor(transcript(8), 8);
    const diff = diffTurns(turns, prior);
    expect(diff.newTurns).toHaveLength(0);
  });

  test('PreCompact → SessionEnd cycle: second capture is empty', () => {
    const turns = transcript(40);
    // PreCompact at turn 40
    const first = diffTurns(turns, null);
    expect(first.newTurns).toHaveLength(40);
    const afterFirst = recordFor(turns, first.to);
    // SessionEnd at turn 40 — same transcript, no new turns
    const second = diffTurns(turns, afterFirst);
    expect(second.newTurns).toHaveLength(0);
  });
});

describe('recordCapture', () => {
  const empty: SessionIndex = { schema: 1, sessions: {} };

  test('creates a fresh record', () => {
    const next = recordCapture(empty, {
      sessionId: 'abc12345',
      date: '2026-06-01',
      cwd: '~/Kevin',
      from: 1,
      to: 8,
      lastTurnFp: 'fp8',
      briefingStub: 'designing pipeline'
    });
    const rec = next.sessions.abc12345;
    expect(rec.first_seen).toBe('2026-06-01');
    expect(rec.captured_turns).toBe(8);
    expect(rec.briefing).toBe('designing pipeline');
    expect(rec.blocks).toEqual([{ date: '2026-06-01', from: 1, to: 8 }]);
  });

  test('contiguous same-day capture coalesces blocks, preserves first_seen/briefing', () => {
    const after1 = recordCapture(empty, {
      sessionId: 'abc12345',
      date: '2026-06-01',
      cwd: '~/Kevin',
      from: 1,
      to: 40,
      lastTurnFp: 'fp40',
      briefingStub: 'original'
    });
    const after2 = recordCapture(after1, {
      sessionId: 'abc12345',
      date: '2026-06-01',
      cwd: '~/Kevin',
      from: 41,
      to: 55,
      lastTurnFp: 'fp55',
      briefingStub: 'IGNORED on extend'
    });
    const rec = after2.sessions.abc12345;
    expect(rec.captured_turns).toBe(55);
    expect(rec.briefing).toBe('original');
    expect(rec.blocks).toEqual([{ date: '2026-06-01', from: 1, to: 55 }]);
  });

  test('resume on a later day appends a separate block', () => {
    const mon = recordCapture(empty, {
      sessionId: 'abc12345',
      date: '2026-06-01',
      cwd: '~/Kevin',
      from: 1,
      to: 8,
      lastTurnFp: 'fp8',
      briefingStub: 'mon'
    });
    const wed = recordCapture(mon, {
      sessionId: 'abc12345',
      date: '2026-06-03',
      cwd: '~/Kevin',
      from: 9,
      to: 15,
      lastTurnFp: 'fp15',
      briefingStub: 'wed'
    });
    const rec = wed.sessions.abc12345;
    expect(rec.first_seen).toBe('2026-06-01');
    expect(rec.last_seen).toBe('2026-06-03');
    expect(rec.blocks).toEqual([
      { date: '2026-06-01', from: 1, to: 8 },
      { date: '2026-06-03', from: 9, to: 15 }
    ]);
  });
});

describe('header format ↔ parse round-trip', () => {
  test('fresh-session header parses back to the same fields', () => {
    const header = formatEntryHeader({
      heading: 'Session',
      time: '09:14',
      idShort: 'abc12345',
      date: '2026-06-01',
      source: '~/Documents/Agents/Kevin',
      from: 1,
      to: 8
    });
    const [parsed] = parseEntryHeaders(header);
    expect(parsed).toEqual({
      heading: 'Session',
      idShort: 'abc12345',
      date: '2026-06-01',
      source: '~/Documents/Agents/Kevin',
      from: 1,
      to: 8
    });
  });

  test('continuation header with markers still parses the core fields', () => {
    const header = formatEntryHeader({
      heading: 'Session',
      time: '11:02',
      idShort: 'abc12345',
      date: '2026-06-03',
      source: '~/Kevin',
      from: 9,
      to: 15,
      continues: '2026-06-01',
      reanchored: true
    });
    expect(header).toContain('↩ continues 2026-06-01');
    expect(header).toContain('⚠ re-anchored');
    const [parsed] = parseEntryHeaders(header);
    expect(parsed.from).toBe(9);
    expect(parsed.to).toBe(15);
    expect(parsed.idShort).toBe('abc12345');
  });

  test('preserves the load-bearing `### Session (HH:MM) ` prefix', () => {
    const header = formatEntryHeader({
      heading: 'Session',
      time: '09:14',
      idShort: 'abc12345',
      date: '2026-06-01',
      source: '~/Kevin',
      from: 1,
      to: 8
    });
    expect(header.startsWith('### Session (09:14) ')).toBe(true);
  });

  test('legacy headers without a turn range are skipped', () => {
    const legacy = '### Session (09:14) [abc12345] · ~/Kevin';
    expect(parseEntryHeaders(legacy)).toHaveLength(0);
  });
});
