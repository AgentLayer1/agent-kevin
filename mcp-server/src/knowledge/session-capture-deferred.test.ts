import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR_DEFAULT } from '@/shared/naming';

/**
 * Codex kills a SessionEnd hook after 3 seconds. A capture that cannot take the
 * lock in time must not be lost and must not write unlocked: it is queued, and the
 * next capture to hold the lock runs it.
 */
const HOME = mkdtempSync(resolve(tmpdir(), 'capture-deferred-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

const DATA = resolve(HOME, RUNTIME_DIR_DEFAULT);
const SESSIONS = resolve(HOME, 'knowledge', 'raw', 'sessions');
const LOCK = resolve(DATA, 'capture.lock');
const PENDING = resolve(DATA, 'capture-pending.jsonl');

let captureSession: typeof import('@/knowledge/session-capture').captureSession;
let drainDeferredCaptures: typeof import('@/knowledge/session-capture').drainDeferredCaptures;

const transcript = (name: string, turns: number): string => {
  const path = resolve(HOME, `${name}.jsonl`);
  const lines = Array.from({ length: turns }, (_unused, index) =>
    JSON.stringify({ message: { role: index % 2 === 0 ? 'user' : 'assistant', content: `${name} turn ${index + 1}` } })
  );
  writeFileSync(path, lines.join('\n'), 'utf-8');
  return path;
};
const dayFile = (): string => {
  const [file] = require('node:fs').readdirSync(SESSIONS) as string[];
  return file ? readFileSync(resolve(SESSIONS, file), 'utf-8') : '';
};

beforeAll(async () => {
  mkdirSync(SESSIONS, { recursive: true });
  mkdirSync(DATA, { recursive: true });
  writeFileSync(resolve(DATA, HOME_MARKER_FILES[0]), '{}\n');
  ({ captureSession, drainDeferredCaptures } = await import('@/knowledge/session-capture'));
});

afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  if (PRELOAD_HOME === undefined) delete process.env.AGENT_HOME;
  else process.env.AGENT_HOME = PRELOAD_HOME;
});

describe('deferred capture', () => {
  test('a held lock defers the capture to the pending file instead of writing unlocked or losing it', async () => {
    mkdirSync(LOCK, { recursive: true });
    writeFileSync(resolve(LOCK, 'owner'), 'someone-else', 'utf-8');
    const first = transcript('first', 2);
    const result = await captureSession({
      transcriptPath: first,
      cwd: HOME,
      sessionId: 'first-session',
      mode: 'session-end'
    });
    expect(result).toEqual({ saved: false, reason: 'deferred' });
    expect(JSON.parse(readFileSync(PENDING, 'utf-8').trim())).toMatchObject({ sessionId: 'first-session' });
    expect(dayFile()).toBe('');
    rmSync(LOCK, { recursive: true, force: true });
  });

  test('the next capture to hold the lock drains the queue before its own work', async () => {
    const second = transcript('second', 2);
    const result = await captureSession({
      transcriptPath: second,
      cwd: HOME,
      sessionId: 'second-session',
      mode: 'session-end'
    });
    expect(result.saved).toBe(true);
    expect(existsSync(PENDING)).toBe(false);
    const day = dayFile();
    expect(day).toContain('[first-session]');
    expect(day).toContain('[second-session]');
    expect(day.indexOf('[first-session]')).toBeLessThan(day.indexOf('[second-session]'));
  });

  test('a session start drains too, and a drained capture is not repeated', async () => {
    mkdirSync(LOCK, { recursive: true });
    writeFileSync(resolve(LOCK, 'owner'), 'someone-else', 'utf-8');
    const third = transcript('third', 2);
    await captureSession({ transcriptPath: third, cwd: HOME, sessionId: 'third-session', mode: 'session-end' });
    rmSync(LOCK, { recursive: true, force: true });
    await drainDeferredCaptures();
    expect(existsSync(PENDING)).toBe(false);
    expect(dayFile().split('[third-session]').length).toBe(2);
    await drainDeferredCaptures();
    expect(dayFile().split('[third-session]').length).toBe(2);
  });
});
