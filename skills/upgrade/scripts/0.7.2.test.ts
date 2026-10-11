import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '0.7.2.ts');

const homes: string[] = [];
const makeHome = (settings?: unknown): string => {
  const home = mkdtempSync(join(tmpdir(), 'migrate-072-'));
  homes.push(home);
  if (settings !== undefined) {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  }
  return home;
};
const run = (home: string): { ok: boolean; askDropped: string[] } => {
  const result = spawnSync('bun', [SCRIPT], {
    env: { ...process.env, KEVIN_HOME: home, AGENT_HOME: home },
    encoding: 'utf-8'
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}');
};
const readSettings = (home: string): unknown =>
  JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf-8'));

afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

describe('0.7.2 RunCodeSnippet ungate', () => {
  test('drops only the snippet gate, keeps the debugger gate and order, then is a no-op', () => {
    const home = makeHome({
      model: 'opus',
      permissions: {
        allow: ['mcp__xcode__*', 'mcp__xcode__RunCodeSnippet'],
        ask: ['Bash(git push)', 'mcp__xcode__InvokeDebuggerCommand', 'mcp__xcode__RunCodeSnippet']
      }
    });
    expect(run(home)).toMatchObject({ ok: true, askDropped: ['mcp__xcode__RunCodeSnippet'] });
    expect(readSettings(home)).toEqual({
      model: 'opus',
      permissions: {
        allow: ['mcp__xcode__*', 'mcp__xcode__RunCodeSnippet'],
        ask: ['Bash(git push)', 'mcp__xcode__InvokeDebuggerCommand']
      }
    });
    const before = readFileSync(join(home, '.claude', 'settings.json'), 'utf-8');
    expect(run(home)).toMatchObject({ ok: true, askDropped: [] });
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf-8')).toBe(before);
  });

  test('a home without the Xcode pack is left untouched', () => {
    const home = makeHome({ permissions: { ask: ['Bash(git push)'] } });
    const before = readFileSync(join(home, '.claude', 'settings.json'), 'utf-8');
    expect(run(home)).toMatchObject({ ok: true, askDropped: [] });
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf-8')).toBe(before);
  });

  test('a home without settings is a no-op', () => {
    expect(run(makeHome())).toMatchObject({ ok: true, askDropped: [] });
  });
});
