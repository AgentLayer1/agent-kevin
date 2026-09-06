import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, 'automode-block.ts');
const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'automode-'));
  dirs.push(dir);
  return dir;
};
const run = (...extra: string[]) => {
  const proc = spawnSync(process.execPath, [SCRIPT, ...extra], { encoding: 'utf-8' });
  return { code: proc.status, json: proc.stdout.trim() ? JSON.parse(proc.stdout) : null, stderr: proc.stderr };
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('automode-block', () => {
  test('prints the canonical block with the home path substituted', () => {
    const { code, json } = run('--home', '/Users/ada/Agents/Scout', '--settings', join(scratch(), 'none.json'));
    expect(code).toBe(0);
    expect(json.permissions.defaultMode).toBe('auto');
    expect(JSON.stringify(json)).not.toContain('<HOME_DIR>');
    expect(json.autoMode.environment.some((e: string) => e.includes('/Users/ada/Agents/Scout'))).toBe(true);
    expect(json.autoMode.allow.some((r: string) => r.includes('AGENTS.md'))).toBe(true);
    expect(
      json.autoMode.soft_deny.some((r: string) => r.startsWith('Identity File Replacement') && r.includes('AGENTS.md'))
    ).toBe(true);
  });

  test('--check: absent when the operator never adopted the block', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }));
    const { json } = run(
      '--home',
      dir,
      '--check',
      '--settings',
      join(dir, 'settings.json'),
      '--out',
      join(dir, 'note.md')
    );
    expect(json.status).toBe('absent');
    expect(json.defaultMode).toBe('auto');
    expect(json.replacements).toHaveLength(json.rules.length);
    expect(readFileSync(join(dir, 'note.md'), 'utf-8')).toContain('## Full recommended block');
  });

  test('--check: stale entries are named and their replacement text is the canonical one', () => {
    const dir = scratch();
    const canonical = run('--home', dir, '--settings', join(dir, 'none.json')).json;
    const user = {
      autoMode: {
        environment: ['$defaults', 'Agent homes: ' + dir + ' and /somewhere/else — operator-extended'],
        allow: canonical.autoMode.allow.map((r: string) =>
          r.startsWith('Agent Knowledge Base')
            ? r.replace(
                ' and its operating manual (AGENTS.md, read back as instructions every session by every harness)',
                ''
              )
            : r
        ),
        soft_deny: canonical.autoMode.soft_deny.filter((r: string) => !r.startsWith('Cross-Agent Home Write'))
      }
    };
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(user));
    const { json } = run(
      '--home',
      dir,
      '--check',
      '--settings',
      join(dir, 'settings.json'),
      '--out',
      join(dir, 'out', 'automode-block.md')
    );
    expect(json.status).toBe('stale');
    const byName = Object.fromEntries(json.rules.map((r: { name: string; state: string }) => [r.name, r.state]));
    expect(byName['Agent Knowledge Base']).toBe('stale');
    expect(byName['Cross-Agent Home Write']).toBe('missing');
    expect(byName['Identity File Replacement']).toBe('current');
    expect(json.replacements.map((r: { name: string }) => r.name).sort()).toEqual([
      'Agent Knowledge Base',
      'Cross-Agent Home Write'
    ]);
    expect(json.replacements.find((r: { name: string }) => r.name === 'Agent Knowledge Base').text).toContain(
      'AGENTS.md'
    );
    // environment is never proposed for replacement
    expect(json.replacements.some((r: { list: string }) => r.list === 'environment')).toBe(false);
    const akb = json.replacements.find((r: { name: string }) => r.name === 'Agent Knowledge Base');
    expect(akb.changes.length).toBeGreaterThan(0);
    expect(akb.changes[0].new).toContain('operating manual (AGENTS.md');
    expect(existsSync(join(dir, 'out', 'automode-block.md'))).toBe(true);
    const note = readFileSync(join(dir, 'out', 'automode-block.md'), 'utf-8');
    expect(note).toContain('**Status: stale.** 2 of 5 rules');
    expect(note).toContain('the string starting `"Agent Knowledge Base`');
    expect(note).toContain('- OLD: ');
    expect(note).toContain('Not in your settings yet');
    // An operator who already has a block never gets the whole single-home template offered.
    expect(note).not.toContain('## Full recommended block');
    expect(note).toContain('never compared or replaced');
  });

  test('--check: current when every rule matches', () => {
    const dir = scratch();
    const canonical = run('--home', dir, '--settings', join(dir, 'none.json')).json;
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ permissions: { defaultMode: 'auto' }, autoMode: canonical.autoMode })
    );
    const { json } = run('--home', dir, '--check', '--settings', join(dir, 'settings.json'));
    expect(json.status).toBe('current');
    expect(json.replacements).toEqual([]);
  });
});
