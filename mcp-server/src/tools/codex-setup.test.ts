import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR_DEFAULT } from '@/shared/naming';

/** Its own throwaway home, pinned before the tool resolves paths, so nothing lands in a real checkout. */
const HOME = mkdtempSync(resolve(tmpdir(), 'codex-setup-tool-'));
const PRELOAD_HOME = process.env.AGENT_HOME;
process.env.AGENT_HOME = HOME;

let tools: typeof import('@/tools/codex-setup').tools;

beforeAll(async () => {
  mkdirSync(resolve(HOME, RUNTIME_DIR_DEFAULT), { recursive: true });
  writeFileSync(resolve(HOME, RUNTIME_DIR_DEFAULT, HOME_MARKER_FILES[0]), '{}\n');
  ({ tools } = await import('@/tools/codex-setup'));
});

afterAll(() => {
  rmSync(HOME, { recursive: true, force: true });
  if (PRELOAD_HOME === undefined) delete process.env.AGENT_HOME;
  else process.env.AGENT_HOME = PRELOAD_HOME;
});

describe('codex_setup tool', () => {
  test('runs the generator against this home and returns its report', async () => {
    const [tool] = tools;
    expect(tool.name).toBe('codex_setup');
    const result = (await tool.handler({})) as { ok: boolean; report?: { entries: number; hooks: { path: string } } };
    expect(result.ok).toBe(true);
    expect(result.report?.entries).toBe(4);
    expect(result.report?.hooks.path).toBe(resolve(HOME, '.codex', 'hooks.json'));
    expect(existsSync(resolve(HOME, '.codex', 'rules', 'kevin.rules'))).toBe(true);
    expect(readFileSync(resolve(HOME, '.codex', 'config.toml'), 'utf-8')).toContain(`AGENT_HOME = "${HOME}"`);
  });
});
