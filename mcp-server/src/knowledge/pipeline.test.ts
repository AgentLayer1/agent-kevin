import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// One hermetic HOME for the whole pipeline. `config` resolves its paths once at
// import time (singleton), so a single KEVIN_HOME — set before any dynamic
// import — keeps capture and compile pointed at the same throwaway tree. The
// compile suite resets state in its own beforeAll to isolate from capture.
const HOME = mkdtempSync(resolve(tmpdir(), 'kevin-pipeline-'));
process.env.KEVIN_HOME = HOME;
process.env.KEVIN_TIMEZONE = 'Asia/Kuala_Lumpur';

const SESSIONS = resolve(HOME, 'knowledge', 'raw', 'sessions');
const transcriptPath = resolve(HOME, 'transcript.jsonl');

let captureSession: typeof import('@/knowledge/session-capture').captureSession;
let pickNext: typeof import('@/knowledge/compile').pickNext;
let markComplete: typeof import('@/knowledge/compile').markComplete;
let getStatus: typeof import('@/knowledge/compile').getStatus;
let hashBuffer: typeof import('@/knowledge/utils').hashBuffer;
let SESSION_INDEX: string;
let STATE_PATH: string;

beforeAll(async () => {
  mkdirSync(SESSIONS, { recursive: true });
  writeFileSync(resolve(HOME, 'SOUL.md'), '# Soul', 'utf-8'); // isInitialized() gate
  ({ captureSession } = await import('@/knowledge/session-capture'));
  ({ pickNext, markComplete, getStatus } = await import('@/knowledge/compile'));
  ({ hashBuffer } = await import('@/knowledge/utils'));
  const { FILES } = await import('@/config');
  SESSION_INDEX = FILES.SESSION_INDEX;
  STATE_PATH = FILES.KNOWLEDGE_STATE;
});

afterAll(() => {
  delete process.env.KEVIN_HOME;
  delete process.env.KEVIN_TIMEZONE;
});

// ── Capture: incremental + resume-safe ───────────────────────────────

describe('captureSession', () => {
  const writeTranscript = (n: number) => {
    const lines = Array.from({ length: n }, (_unused, i) =>
      JSON.stringify({
        message: { role: i % 2 === 0 ? 'user' : 'assistant', content: `message number ${i + 1}` }
      })
    );
    writeFileSync(transcriptPath, lines.join('\n'), 'utf-8');
  };
  const capture = (mode: 'session-end' | 'pre-compact') =>
    captureSession({ transcriptPath, cwd: HOME, sessionId: 'deadbeefcafe', mode, selfDefer: false });

  let logPath = '';

  test('first capture writes all turns with a turn-range header', async () => {
    writeTranscript(8);
    const result = await capture('session-end');
    expect(result.saved).toBe(true);
    if (!result.saved) return;
    logPath = result.path;
    expect(result.turns).toBe(8);
    const log = readFileSync(logPath, 'utf-8');
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

  test('resume appends only the delta — earlier turns are never re-dumped', async () => {
    writeTranscript(12);
    const result = await capture('session-end');
    expect(result.saved).toBe(true);
    if (!result.saved) return;
    expect(result.turns).toBe(4);
    const log = readFileSync(logPath, 'utf-8');
    expect(log).toContain('turns 9–12');
    expect(log.match(/message number 1\b/g)).toHaveLength(1);
    expect(log.match(/turns 1–8/g)).toHaveLength(1);
  });

  test('the index tracks the cursor and turn coverage', () => {
    const index = JSON.parse(readFileSync(SESSION_INDEX, 'utf-8'));
    const rec = index.sessions.deadbeef;
    expect(rec.captured_turns).toBe(12);
    expect(rec.blocks).toEqual([{ date: rec.last_seen, from: 1, to: 12 }]);
    expect(rec.briefing.length).toBeGreaterThan(0);
  });

  test('concurrent captures of the same new session write exactly one block (mutex)', async () => {
    writeTranscript(8);
    const fire = () =>
      captureSession({ transcriptPath, cwd: HOME, sessionId: 'racer123beef', mode: 'session-end', selfDefer: false });
    const results = await Promise.all([fire(), fire()]);
    // Exactly one writes; the serialized loser sees the cursor and skips.
    expect(results.filter((r) => r.saved).length).toBe(1);
    expect(results.filter((r) => !r.saved && r.reason === 'no-new-turns').length).toBe(1);
    const log = readFileSync(logPath, 'utf-8');
    expect(log.match(/\[racer123\]/g)).toHaveLength(1);
    const index = JSON.parse(readFileSync(SESSION_INDEX, 'utf-8'));
    expect(index.sessions.racer123.captured_turns).toBe(8);
    expect(index.sessions.racer123.blocks).toHaveLength(1);
  });
});

// ── Compile: incremental, today-inclusive, corruption-safe ───────────

describe('incremental compile', () => {
  const dayFile = resolve(SESSIONS, '2026-06-01.md');
  const legacyFile = resolve(SESSIONS, '2026-05-30.md');
  const entry = (time: string, id: string, range: string, topic: string) =>
    `### Session (${time}) [${id}] · 2026-06-01 · ~/Kevin · turns ${range}\n\n` +
    `**User:** ${topic} discussion\n\n**Assistant:** about the ${topic}\n\n---\n\n`;

  beforeAll(() => {
    // Isolate from the capture suite: fresh sessions dir + empty compile state.
    rmSync(SESSIONS, { recursive: true, force: true });
    mkdirSync(SESSIONS, { recursive: true });
    rmSync(STATE_PATH, { force: true });
    writeFileSync(dayFile, `# Session Log: 2026-06-01\n\n${entry('09:00', 'aaa11111', '1–2', 'first topic')}`, 'utf-8');
  });

  test("today's file is compiled immediately (no ignore-today)", async () => {
    const item = await pickNext();
    expect(item).not.toBeNull();
    expect(item?.fileName).toBe('2026-06-01.md');
    expect(item?.prompt).toContain('first topic');
    expect((await markComplete(item!.itemId)).promoted).toBe(true);
  });

  test('a fully-compiled file is no longer pending; cursor stored as bytes', async () => {
    expect(await pickNext()).toBeNull();
    expect((await getStatus()).pending.sessions).toBe(0);
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    expect(state.ingested['2026-06-01.md'].bytes).toBeGreaterThan(0);
  });

  test('appending an entry makes only the delta pending', async () => {
    appendFileSync(dayFile, entry('11:00', 'aaa11111', '3–4', 'second topic'), 'utf-8');
    const item = await pickNext();
    expect(item?.prompt).toContain('second topic');
    expect(item?.prompt).not.toContain('first topic');
    expect((item?.meta.sliceStart as number) > 0).toBe(true);
    expect((await markComplete(item!.itemId)).promoted).toBe(true);
    expect(await pickNext()).toBeNull();
  });

  test('corruption guard: editing the compiled prefix forces a from-scratch recompile', async () => {
    writeFileSync(dayFile, readFileSync(dayFile, 'utf-8').replace('first topic discussion', 'EDITED PREFIX'), 'utf-8');
    const item = await pickNext();
    expect(item?.meta.sliceStart).toBe(0);
    expect(item?.prompt).toContain('EDITED PREFIX');
    await markComplete(item!.itemId);
    expect(await pickNext()).toBeNull();
  });

  test('legacy record (no bytes) skips an unchanged file, recompiles a changed one', async () => {
    writeFileSync(legacyFile, `# Session Log: 2026-05-30\n\n${entry('08:00', 'bbb22222', '1–2', 'legacy topic')}`, 'utf-8');
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    state.ingested['2026-05-30.md'] = {
      hash: hashBuffer(readFileSync(legacyFile)),
      compiled_at: '2026-05-30T00:00:00+08:00',
      cost_usd: 0
    };
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
    expect(await pickNext()).toBeNull(); // unchanged legacy → skipped

    appendFileSync(legacyFile, entry('09:30', 'bbb22222', '3–4', 'legacy addition'), 'utf-8');
    const item = await pickNext();
    expect(item?.fileName).toBe('2026-05-30.md');
    expect(item?.meta.sliceStart).toBe(0);
    await markComplete(item!.itemId);
    expect(await pickNext()).toBeNull();
  });
});
