import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { runtimeDirName } from '@/shared/naming';

const HOME = mkdtempSync(resolve(tmpdir(), 'prune-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

const MEMORY = resolve(HOME, 'knowledge', 'memory');
const ARCHIVE = resolve(MEMORY, 'archive', 'decisions-2026-09.md');
let pruneMemory: typeof import('@/knowledge/prune').pruneMemory;

beforeAll(async () => {
  mkdirSync(resolve(MEMORY, 'archive'), { recursive: true });
  mkdirSync(resolve(HOME, runtimeDirName()), { recursive: true });
  writeFileSync(resolve(HOME, runtimeDirName(), 'version.json'), '{}\n');
  ({ pruneMemory } = await import('@/knowledge/prune'));
});

afterAll(() => {
  process.env.AGENT_HOME = PRELOAD_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

describe('pruneMemory', () => {
  test('an archived link to a daily file that is gone names the session log; a live one stays', async () => {
    const today = new Date().toLocaleDateString('sv-SE');
    writeFileSync(resolve(MEMORY, `${today}.md`), '# today\n');
    writeFileSync(
      ARCHIVE,
      `- 2026-09-01 — shipped. Detail in [[memory/2026-09-01]].\n- 2026-09-02 — aliased [[memory/2026-09-02|notes]].\n- today — [[memory/${today}]].\n`
    );
    await pruneMemory();
    expect(readFileSync(ARCHIVE, 'utf-8')).toBe(
      `- 2026-09-01 — shipped. Detail in the 2026-09-01 session log.\n- 2026-09-02 — aliased the 2026-09-02 session log.\n- today — [[memory/${today}]].\n`
    );
  });
});
