import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, 'home-baseline.ts');
const TEMPLATE = readFileSync(resolve(import.meta.dir, '..', '..', '..', 'templates', '.gitignore'), 'utf-8');
const MISSING_GRANTS = [
  'Skill(agent-kevin:dashboard)',
  'Skill(agent-kevin:where-am-i)',
  'Skill(agent-kevin:humanizer)',
  'Skill(agent-kevin:setup-worktree)',
  'Skill(agent-kevin:plan-spec)',
  'mcp__plugin_agent-kevin_kevin__setup_worktree'
];

const dirs: string[] = [];
const scratchHome = (files: { gitignore?: string; settings?: object } = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), 'home-baseline-'));
  dirs.push(dir);
  spawnSync('git', ['init', '-q', dir]);
  if (files.gitignore !== undefined) {
    writeFileSync(join(dir, '.gitignore'), files.gitignore);
  }
  if (files.settings) {
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(files.settings));
  }
  return dir;
};
const run = (home: string, extra: string[] = [], reports?: string) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== 'KEVIN_REPORTS' && key !== 'AGENT_REPORTS')
  );
  const proc = spawnSync(process.execPath, [SCRIPT, '--home', home, ...extra], {
    encoding: 'utf-8',
    env: reports ? { ...env, AGENT_REPORTS: reports } : env
  });
  expect(proc.stderr).toBe('');
  return JSON.parse(proc.stdout);
};
const gitignoreOf = (home: string): string => readFileSync(join(home, '.gitignore'), 'utf-8');
const ignored = (home: string, path: string): boolean =>
  spawnSync('git', ['-C', home, '-c', 'core.excludesFile=/dev/null', 'check-ignore', '-q', path]).status === 0;
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('home-baseline gitignore', () => {
  test('rewrites a bare .kevin/ so the compile cursor and baseline become trackable', () => {
    const home = scratchHome({ gitignore: 'node_modules/\n.kevin/\n' });
    const report = run(home, ['--write']);
    expect(report.gitignore.rewritten).toEqual(['.kevin/']);
    expect(report.gitignore.added).toContain('!.kevin/knowledge.json');
    expect(report.gitignore.added).toContain('reports/captures/');
    expect(gitignoreOf(home).startsWith('node_modules/\n.kevin/*\n')).toBe(true);
    expect(ignored(home, '.kevin/knowledge.json')).toBe(false);
    expect(ignored(home, '.kevin/version.json')).toBe(false);
    expect(ignored(home, '.kevin/secrets/.env')).toBe(true);
    expect(ignored(home, '.kevin/logs/server.log')).toBe(true);
    expect(ignored(home, 'reports/captures/shot.png')).toBe(true);
  });

  test('rewrites the anchored and slashless bare forms too', () => {
    const home = scratchHome({ gitignore: '/.kevin\n' });
    expect(run(home, ['--write']).gitignore.rewritten).toEqual(['/.kevin']);
    expect(ignored(home, '.kevin/knowledge.json')).toBe(false);
    expect(ignored(home, '.kevin/secrets/.env')).toBe(true);
  });

  test('adds the missing cursor negation to a home that only un-ignores version.json', () => {
    const operator = '# mine\nbuild/\n.kevin/*\n!.kevin/version.json\n';
    const home = scratchHome({ gitignore: operator });
    const report = run(home, ['--write']);
    expect(report.gitignore.rewritten).toEqual([]);
    expect(report.gitignore.added).toContain('!.kevin/knowledge.json');
    expect(report.gitignore.added).not.toContain('.kevin/*');
    expect(report.gitignore.added).not.toContain('!.kevin/version.json');
    expect(gitignoreOf(home).startsWith(operator)).toBe(true);
    expect(ignored(home, '.kevin/knowledge.json')).toBe(false);
    expect(ignored(home, '.kevin/secrets/.env')).toBe(true);
    expect(ignored(home, 'build/out.js')).toBe(true);
  });

  test('re-adds a negation the operator placed above the rule it carves out of', () => {
    const operator = '!.kevin/knowledge.json\n.kevin/*\n!.kevin/version.json\n';
    const home = scratchHome({ gitignore: operator });
    expect(ignored(home, '.kevin/knowledge.json')).toBe(true);
    expect(run(home, ['--write']).gitignore.added).toContain('!.kevin/knowledge.json');
    expect(gitignoreOf(home).startsWith(operator)).toBe(true);
    expect(ignored(home, '.kevin/knowledge.json')).toBe(false);
  });

  test('appends an anchor before its negation when the home has neither', () => {
    const home = scratchHome({ gitignore: '.DS_Store' });
    const { added } = run(home, ['--write']).gitignore;
    expect(added.indexOf('.kevin/*')).toBeLessThan(added.indexOf('!.kevin/knowledge.json'));
    expect(gitignoreOf(home).startsWith('.DS_Store\n\n# agent-kevin\n')).toBe(true);
    expect(ignored(home, '.kevin/knowledge.json')).toBe(false);
    expect(ignored(home, '.kevin/secrets/.env')).toBe(true);
  });

  test('keeps CRLF line endings', () => {
    const home = scratchHome({ gitignore: 'build/\r\n.kevin/\r\n' });
    run(home, ['--write']);
    expect(gitignoreOf(home).replaceAll('\r\n', '')).not.toContain('\n');
  });

  test('copies the template when the home has no .gitignore', () => {
    const home = scratchHome();
    expect(run(home, ['--write']).gitignore.created).toBe(true);
    expect(gitignoreOf(home)).toBe(TEMPLATE);
  });

  test('a second run changes nothing', () => {
    const home = scratchHome({ gitignore: '.kevin/\n' });
    run(home, ['--write']);
    const after = gitignoreOf(home);
    expect(run(home, ['--write']).gitignore).toEqual({ created: false, added: [], rewritten: [] });
    expect(gitignoreOf(home)).toBe(after);
    expect(run(scratchHome({ gitignore: TEMPLATE })).gitignore.added).toEqual([]);
  });

  test('reports without --write and leaves the file alone', () => {
    const home = scratchHome({ gitignore: '.kevin/\n' });
    expect(run(home).gitignore.rewritten).toEqual(['.kevin/']);
    expect(gitignoreOf(home)).toBe('.kevin/\n');
  });
});

describe('home-baseline settings', () => {
  const fresh = run(scratchHome()).settings;
  const baselineAllowMinus = (drop: string[]): string[] =>
    fresh.allowMissing.filter((entry: string) => !drop.includes(entry));

  test('reports the baseline grants a home is missing, and keeps remove_worktree out', () => {
    expect(fresh.allowMissing).toEqual(expect.arrayContaining(MISSING_GRANTS));
    expect(fresh.allowMissing).not.toContain('mcp__plugin_agent-kevin_kevin__remove_worktree');
    const home = scratchHome({
      settings: {
        permissions: { allow: [...baselineAllowMinus(MISSING_GRANTS), 'Bash(make *)'], ask: fresh.askMissing }
      }
    });
    const { settings } = run(home);
    expect(settings.allowMissing.sort()).toEqual([...MISSING_GRANTS].sort());
    expect(settings.askMissing).toEqual([]);
  });

  test('never re-grants an entry the operator moved to ask or deny', () => {
    const home = scratchHome({
      settings: {
        permissions: {
          allow: baselineAllowMinus(MISSING_GRANTS),
          ask: ['Skill(agent-kevin:plan-spec)'],
          deny: ['Skill(agent-kevin:humanizer)']
        }
      }
    });
    const missing = run(home).settings.allowMissing;
    expect(missing).not.toContain('Skill(agent-kevin:plan-spec)');
    expect(missing).not.toContain('Skill(agent-kevin:humanizer)');
    expect(missing).toContain('Skill(agent-kevin:where-am-i)');
  });

  test('backfills an ask guard even when the entry sits in allow, never when it sits in deny', () => {
    expect(fresh.askMissing).toContain('Bash(git push)');
    const home = scratchHome({
      settings: { permissions: { allow: ['Bash(git push)'], deny: ['Bash(gh pr merge *)'] } }
    });
    const { askMissing } = run(home).settings;
    expect(askMissing).toContain('Bash(git push)');
    expect(askMissing).not.toContain('Bash(gh pr merge *)');
  });

  test('plansDirectory follows the reports root and never overrides an existing value', () => {
    expect(fresh.plansDirectory).toBe('./reports/plans');
    const relocated = join(tmpdir(), 'elsewhere', 'reports');
    expect(run(scratchHome(), [], relocated).settings.plansDirectory).toBe(join(relocated, 'plans'));
    const home = scratchHome({ settings: { plansDirectory: './.claude/plans' } });
    expect(run(home).settings.plansDirectory).toBeNull();
  });
});
