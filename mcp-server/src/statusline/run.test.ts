import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dir, '..', '..', '..', 'bin', 'kevin');
const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'statusline-run-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '');
const run = (input: string, cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, [CLI, 'statusline', ...args], { input, cwd, encoding: 'utf-8' });

describe('kevin statusline', () => {
  test('renders the footer from stdin outside any agent home, with the branch of the payload directory', () => {
    const repo = scratch();
    spawnSync('git', ['init', '-q', '-b', 'feature/x'], { cwd: repo });
    const proc = run(
      JSON.stringify({
        model: { display_name: 'Opus' },
        workspace: { current_dir: repo, project_dir: repo },
        cost: { total_cost_usd: 0.5, total_duration_ms: 60_000 },
        context_window: { used_percentage: 10 }
      }),
      scratch()
    );
    expect(proc.status).toBe(0);
    expect(plain(proc.stdout)).toBe(
      `🤖 Opus │ 📁 ${resolve(repo).split('/').at(-1)} │ 🌿 feature/x\n\n█⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿ 10% │ $0.50 ($30.00/hr) │ ⏱ 1m 0s`
    );
  });

  test('leads with the emoji of the launch directory IDENTITY.md', () => {
    const home = scratch();
    writeFileSync(join(home, 'IDENTITY.md'), '# Identity\n\n- **Name:** Scout\n- **Emoji:** 🔭\n');
    const proc = run(
      JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: home, project_dir: home } }),
      home
    );
    expect(plain(proc.stdout)).toStartWith('🔭 Opus');
  });

  test('a payload it cannot read renders nothing and still exits 0', () => {
    const proc = run('{not json', scratch());
    expect(proc.status).toBe(0);
    expect(proc.stdout).toBe('');
  });

  test('--subagent writes one JSON row per task', () => {
    const proc = run(
      JSON.stringify({ columns: 60, tasks: [{ id: 'a', name: 'A', tokenCount: 5 }] }),
      scratch(),
      '--subagent'
    );
    expect(JSON.parse(proc.stdout)).toEqual({ id: 'a', content: expect.stringContaining('A · ') });
  });

  test('--setting prints the settings entry that runs this very script', () => {
    const proc = run('', scratch(), '--setting');
    expect(JSON.parse(proc.stdout)).toEqual({ statusLine: { type: 'command', command: `bun "${CLI}" statusline` } });
  });
});
