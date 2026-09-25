import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR_DEFAULT } from '@/shared/naming';

/** Its own throwaway home, pinned before the tool resolves paths, so nothing lands in a real checkout. */
const ROOT = realpathSync(mkdtempSync(resolve(tmpdir(), 'home-history-tool-')));
const HOME = resolve(ROOT, 'Ada');
const GIT_DIR = resolve(ROOT, 'ada-data.git');
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

let tools: typeof import('@/tools/home-history').tools;

beforeAll(async () => {
  mkdirSync(resolve(HOME, RUNTIME_DIR_DEFAULT), { recursive: true });
  mkdirSync(resolve(HOME, '.claude'));
  writeFileSync(resolve(HOME, RUNTIME_DIR_DEFAULT, HOME_MARKER_FILES[0]), '{}\n');
  writeFileSync(resolve(HOME, '.claude', 'settings.local.json'), JSON.stringify({ env: { AGENT_HOME_GIT_DIR: GIT_DIR } }));
  execFileSync('git', ['-C', HOME, 'init', '-q', '-b', 'main', '--separate-git-dir', GIT_DIR], { env: process.env });
  execFileSync('git', ['--git-dir', GIT_DIR, 'config', 'agent.home', HOME], { env: process.env });
  ({ tools } = await import('@/tools/home-history'));
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  if (PRELOAD_HOME === undefined) {
    delete process.env.AGENT_HOME;
  } else {
    process.env.AGENT_HOME = PRELOAD_HOME;
  }
});

describe('home_history tool', () => {
  test('status puts back a .git link a synced folder deleted, then reports', async () => {
    rmSync(resolve(HOME, '.git'));
    expect(await tools[0].handler({ action: 'status' })).toMatchObject({ restored: true, state: 'on' });
    expect(readFileSync(resolve(HOME, '.git'), 'utf-8')).toBe(`gitdir: ${GIT_DIR}\n`);
  });
});
