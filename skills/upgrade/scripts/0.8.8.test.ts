import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { MCP_PREFIX } from '../../../mcp-server/src/config';

const SCRIPT = resolve(import.meta.dir, '0.8.8.ts');
const OLD = `${MCP_PREFIX}focus_write`;
const NEW = `${MCP_PREFIX}attention_write`;

const homes: string[] = [];
const write = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf-8');
const permissions = (root: string, rel: string): Record<string, string[]> => JSON.parse(read(root, rel)).permissions;

const makeHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'migrate-088-'));
  homes.push(home);
  write(home, 'projects/acme/focus.html', 'acme page');
  write(home, 'projects/beta/focus.html', 'old beta page');
  write(home, 'projects/beta/attention.html', 'new beta page');
  write(home, '.state/focus/queue.json', '{"groups":[]}\n');
  write(
    home,
    '.claude/settings.json',
    `${JSON.stringify({ permissions: { allow: ['Bash(date)', OLD, 'Read'], ask: [OLD], deny: [] } }, null, 2)}\n`
  );
  write(home, '.claude/settings.local.json', `${JSON.stringify({ permissions: { allow: [OLD, NEW] } }, null, 2)}\n`);
  return home;
};

const run = (home: string): { status: number | null; report: Record<string, unknown> } => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_'))) as Record<
    string,
    string
  >;
  const result = spawnSync('bun', [SCRIPT], { env: { ...env, AGENT_HOME: home }, encoding: 'utf-8' });
  return { status: result.status, report: JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') };
};

afterAll(() => homes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('0.8.8 migration', () => {
  test('moves pages and the queue cache, and renames the tool grant in place', () => {
    const home = makeHome();
    const { status, report } = run(home);
    expect(status).toBe(0);
    expect(report).toMatchObject({
      ok: true,
      pages: { moved: ['projects/acme/focus.html'], removed: ['projects/beta/focus.html'] },
      queues: 'moved',
      grants: ['.claude/settings.json', '.claude/settings.local.json']
    });
    expect(read(home, 'projects/acme/attention.html')).toBe('acme page');
    expect(read(home, 'projects/beta/attention.html')).toBe('new beta page');
    expect(existsSync(join(home, 'projects/beta/focus.html'))).toBe(false);
    expect(read(home, '.state/attention/queue.json')).toBe('{"groups":[]}\n');
    expect(existsSync(join(home, '.state/focus'))).toBe(false);
    expect(permissions(home, '.claude/settings.json')).toEqual({
      allow: ['Bash(date)', NEW, 'Read'],
      ask: [NEW],
      deny: []
    });
    expect(permissions(home, '.claude/settings.local.json')).toEqual({ allow: [NEW] });
  });

  test('a second run changes nothing', () => {
    const home = makeHome();
    run(home);
    const settings = read(home, '.claude/settings.json');
    const { status, report } = run(home);
    expect(status).toBe(0);
    expect(report).toMatchObject({ ok: true, pages: { moved: [], removed: [] }, queues: 'absent', grants: [] });
    expect(read(home, '.claude/settings.json')).toBe(settings);
  });

  test('drops the old queue cache when the new one already exists', () => {
    const home = makeHome();
    write(home, '.state/attention/queue.json', '{"groups":["fresh"]}\n');
    const { report } = run(home);
    expect(report).toMatchObject({ queues: 'dropped' });
    expect(read(home, '.state/attention/queue.json')).toBe('{"groups":["fresh"]}\n');
  });

  test('fails loudly on a settings file that is not JSON', () => {
    const home = makeHome();
    write(home, '.claude/settings.json', '{ not json');
    const { status, report } = run(home);
    expect(status).toBe(1);
    expect(report).toMatchObject({ ok: false });
  });
});
