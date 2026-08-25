import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR_DEFAULT } from '@/shared/naming';

/**
 * `pre-compact` differs from `session-end` in exactly two ways — a `Pre-Compact`
 * block heading and a minimum of 5 turns instead of 1 — and until now no test
 * invoked it at all. It's the mode that preserves a long conversation before the
 * host compacts detail away, so a regression there loses material that
 * `session-end` never sees.
 *
 * Its own home, kept apart from the pipeline suite, whose assertions depend on a
 * shared capture cursor.
 */
const HOME = mkdtempSync(resolve(tmpdir(), 'capture-modes-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

const SESSIONS = resolve(HOME, 'knowledge', 'raw', 'sessions');
const transcriptPath = resolve(HOME, 'transcript.jsonl');

let captureSession: typeof import('@/knowledge/session-capture').captureSession;

const writeTranscript = (turns: number): void => {
  const lines = Array.from({ length: turns }, (_unused, index) =>
    JSON.stringify({
      message: { role: index % 2 === 0 ? 'user' : 'assistant', content: `message number ${index + 1}` }
    })
  );
  writeFileSync(transcriptPath, lines.join('\n'), 'utf-8');
};

const capture = (mode: 'session-end' | 'pre-compact', sessionId: string) =>
  captureSession({ transcriptPath, cwd: HOME, sessionId, mode });

beforeAll(async () => {
  mkdirSync(SESSIONS, { recursive: true });
  mkdirSync(resolve(HOME, RUNTIME_DIR_DEFAULT), { recursive: true });
  writeFileSync(resolve(HOME, RUNTIME_DIR_DEFAULT, HOME_MARKER_FILES[0]), '{}\n');
  ({ captureSession } = await import('@/knowledge/session-capture'));
});

afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  if (PRELOAD_HOME === undefined) delete process.env.AGENT_HOME;
  else process.env.AGENT_HOME = PRELOAD_HOME;
});

describe('capture modes', () => {
  test('pre-compact needs 5 turns; 4 is below the threshold', async () => {
    writeTranscript(4);
    const result = await capture('pre-compact', 'precompactshort');
    expect(result.saved).toBe(false);
    expect(result.saved === false && result.reason).toBe('too-few-turns');
  });

  test('pre-compact saves at the threshold, under its own heading', async () => {
    writeTranscript(5);
    const result = await capture('pre-compact', 'precompactokay');
    expect(result.saved).toBe(true);
    const written = readFileSync(resolve(SESSIONS, `${result.saved && result.filename}`), 'utf-8');
    expect(written).toContain('### Pre-Compact');
    expect(written).not.toContain('### Session (');
  });

  test('session-end saves a single turn and uses the Session heading', async () => {
    writeTranscript(1);
    const result = await capture('session-end', 'sessionendone');
    expect(result.saved).toBe(true);
    const written = readFileSync(resolve(SESSIONS, `${result.saved && result.filename}`), 'utf-8');
    expect(written).toContain('### Session (');
  });
});
