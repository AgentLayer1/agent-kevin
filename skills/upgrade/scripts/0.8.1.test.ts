import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '0.8.1.ts');
const IDENTITY = [
  '# Identity',
  '',
  '![Ace](.claude/assets/ace-avatar.jpg)',
  '',
  '- **Name:** Ace',
  '- **Avatar:** [`.claude/assets/ace-avatar.jpg`](.claude/assets/ace-avatar.jpg)',
  ''
].join('\n');

const homes: string[] = [];
const write = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf-8');

const makeHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'migrate-081-'));
  homes.push(home);
  write(home, 'IDENTITY.md', IDENTITY);
  write(home, '.claude/assets/ace-avatar.jpg', 'jpegbytes');
  write(home, '.claude/browser-flows/acme-login/index.ts', 'export {};\n');
  write(home, '.claude/settings.json', '{}\n');
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

describe('0.8.1 migration', () => {
  test('moves the avatar and a flow with its .env, and repoints IDENTITY.md', () => {
    const home = makeHome();
    write(home, '.claude/browser-flows/acme-login/.env', 'ACME_PASSWORD=fixture\n');
    const { status, report } = run(home);
    expect(status).toBe(0);
    expect(report).toMatchObject({
      ok: true,
      moved: ['.claude/assets/ace-avatar.jpg', '.claude/browser-flows/acme-login'],
      deduped: [],
      conflicts: [],
      identityRewritten: true
    });
    expect(read(home, 'assets/ace-avatar.jpg')).toBe('jpegbytes');
    expect(readdirSync(join(home, 'scripts/browser/acme-login')).sort()).toEqual(['.env', 'index.ts']);
    expect(existsSync(join(home, '.claude/assets'))).toBe(false);
    expect(existsSync(join(home, '.claude/browser-flows'))).toBe(false);
    expect(existsSync(join(home, '.claude/settings.json'))).toBe(true);
    expect(read(home, 'IDENTITY.md')).toBe(IDENTITY.replaceAll('.claude/assets/', 'assets/'));
  });

  test('a second run changes nothing', () => {
    const home = makeHome();
    run(home);
    const identity = read(home, 'IDENTITY.md');
    const { status, report } = run(home);
    expect(status).toBe(0);
    expect(report).toMatchObject({ ok: true, moved: [], deduped: [], conflicts: [], identityRewritten: false });
    expect(read(home, 'IDENTITY.md')).toBe(identity);
  });

  test('drops an old copy identical to what is already at the destination', () => {
    const home = makeHome();
    write(home, 'assets/ace-avatar.jpg', 'jpegbytes');
    write(home, 'scripts/browser/acme-login/index.ts', 'export {};\n');
    write(home, '.claude/assets/.DS_Store', 'finder');
    write(home, '.claude/browser-flows/acme-login/Thumbs.db', 'explorer');
    const { report } = run(home);
    expect(report).toMatchObject({
      moved: [],
      deduped: ['.claude/assets/ace-avatar.jpg', '.claude/browser-flows/acme-login'],
      conflicts: [],
      identityRewritten: true
    });
    expect(existsSync(join(home, '.claude/assets'))).toBe(false);
    expect(existsSync(join(home, '.claude/browser-flows'))).toBe(false);
  });

  test('keeps both copies of a differing entry, reports it, and leaves its link alone', () => {
    const home = makeHome();
    write(home, 'assets/ace-avatar.jpg', 'other bytes');
    write(home, 'scripts/browser/acme-login/index.ts', 'export const changed = true;\n');
    const { status, report } = run(home);
    expect(status).toBe(0);
    expect(report).toMatchObject({
      moved: [],
      deduped: [],
      conflicts: ['.claude/assets/ace-avatar.jpg', '.claude/browser-flows/acme-login'],
      identityRewritten: false
    });
    expect(read(home, '.claude/assets/ace-avatar.jpg')).toBe('jpegbytes');
    expect(read(home, 'assets/ace-avatar.jpg')).toBe('other bytes');
    expect(read(home, '.claude/browser-flows/acme-login/index.ts')).toBe('export {};\n');
    expect(read(home, 'IDENTITY.md')).toBe(IDENTITY);
  });

  test('a home with neither folder is left as it was', () => {
    const home = mkdtempSync(join(tmpdir(), 'migrate-081-empty-'));
    homes.push(home);
    write(home, 'IDENTITY.md', '# Identity\n');
    const { status, report } = run(home);
    expect(status).toBe(0);
    expect(report).toMatchObject({ ok: true, moved: [], deduped: [], conflicts: [], identityRewritten: false });
    expect(readdirSync(home)).toEqual(['IDENTITY.md']);
  });
});
