import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// Hermetic HOME so config resolves into a throwaway dir. KEVIN_HOME must be set
// BEFORE config is first imported, so every import in this file is dynamic.
const HOME = mkdtempSync(resolve(tmpdir(), 'kevin-capture-'));
process.env.KEVIN_HOME = HOME;
process.env.KEVIN_TIMEZONE = 'Asia/Kuala_Lumpur';

const SESSIONS = resolve(HOME, 'knowledge', 'raw', 'sessions');
const transcriptPath = resolve(HOME, 'transcript.jsonl');

/** Build a Claude-shaped JSONL transcript with `n` alternating turns. */
const writeTranscript = (n: number) => {
  const lines = Array.from({ length: n }, (_unused, i) =>
    JSON.stringify({
      message: { role: i % 2 === 0 ? 'user' : 'assistant', content: `message number ${i + 1}` }
    })
  );
  writeFileSync(transcriptPath, lines.join('\n'), 'utf-8');
};

let captureSession: typeof import('@/knowledge/session-capture').captureSession;
let SESSION_INDEX: string;

beforeAll(async () => {
  mkdirSync(SESSIONS, { recursive: true });
  // isInitialized() gates on SOUL.md.
  writeFileSync(resolve(HOME, 'SOUL.md'), '# Soul', 'utf-8');
  ({ captureSession } = await import('@/knowledge/session-capture'));
  ({ SESSION_INDEX } = (await import('@/config')).FILES);
});

afterAll(() => {
  delete process.env.KEVIN_HOME;
  delete process.env.KEVIN_TIMEZONE;
});

const capture = (mode: 'session-end' | 'pre-compact') =>
  captureSession({ transcriptPath, cwd: HOME, sessionId: 'deadbeefcafe', mode, selfDefer: false });

describe('captureSession — incremental + resume-safe', () => {
  test('first capture writes all turns with a turn-range header', async () => {
    writeTranscript(8);
    const result = await capture('session-end');
    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.turns).toBe(8);

    const log = readFileSync(result.path, 'utf-8');
    expect(log).toContain('[deadbeef]');
    expect(log).toContain('turns 1–8');
    expect(log).toContain('message number 1');
    expect(log).toContain('message number 8');
  });

  test('re-capture with no new turns is a no-op (the double-dump fix)', async () => {
    const result = await capture('session-end');
    expect(result.saved).toBe(false);
    if (result.saved) return;
    expect(result.reason).toBe('no-new-turns');
  });

  test('resume appends only the delta as a continuation block', async () => {
    writeTranscript(12);
    const result = await capture('session-end');
    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.turns).toBe(4);

    const log = readFileSync(result.path, 'utf-8');
    expect(log).toContain('turns 9–12');
    // turns 1–8 written exactly once — not re-dumped
    expect(log.match(/message number 1\b/g)).toHaveLength(1);
    expect(log.match(/turns 1–8/g)).toHaveLength(1);
  });

  test('the index tracks the cursor and coverage', () => {
    const index = JSON.parse(readFileSync(SESSION_INDEX, 'utf-8'));
    const rec = index.sessions.deadbeef;
    expect(rec.captured_turns).toBe(12);
    expect(rec.blocks).toEqual([{ date: rec.last_seen, from: 1, to: 12 }]);
    expect(rec.briefing.length).toBeGreaterThan(0);
  });
});
