import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, 'home-baseline.ts');
const TEMPLATE = readFileSync(resolve(import.meta.dir, '..', '..', '..', 'templates', '.gitignore'), 'utf-8');
const MISSING_GRANTS = [
  'Skill(agent-kevin:dashboard)',
  'Skill(agent-kevin:focus)',
  'Skill(agent-kevin:humanizer)',
  'Skill(agent-kevin:setup-worktree)',
  'Skill(agent-kevin:plan-spec)',
  'mcp__plugin_agent-kevin_kevin__setup_worktree'
];

const dirs: string[] = [];
const scratchHome = (files: { gitignore?: string; settings?: object; local?: object } = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), 'home-baseline-'));
  dirs.push(dir);
  spawnSync('git', ['init', '-q', dir]);
  if (files.gitignore !== undefined) {
    writeFileSync(join(dir, '.gitignore'), files.gitignore);
  }
  if (files.settings || files.local) {
    mkdirSync(join(dir, '.claude'));
  }
  if (files.settings) {
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(files.settings));
  }
  if (files.local) {
    writeFileSync(join(dir, '.claude', 'settings.local.json'), JSON.stringify(files.local));
  }
  return dir;
};
const claudeDirWith = (settings: object = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), 'home-baseline-claude-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings));
  return dir;
};
const run = (home: string, extra: string[] = [], reports?: string) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== 'KEVIN_REPORTS' && key !== 'AGENT_REPORTS')
  );
  const claudeDir = extra.includes('--claude-dir') ? [] : ['--claude-dir', claudeDirWith()];
  const proc = spawnSync(process.execPath, [SCRIPT, '--home', home, ...claudeDir, ...extra], {
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
    expect(missing).toContain('Skill(agent-kevin:focus)');
  });

  test('reports a retired skill grant with its successor, and its ask placement decides the successor', () => {
    const home = scratchHome({
      settings: {
        permissions: {
          allow: [
            ...baselineAllowMinus(['Skill(agent-kevin:seed)', 'Skill(agent-kevin:briefing)']),
            'Skill(agent-kevin:quick-pulse)'
          ],
          ask: ['Skill(agent-kevin:seed-import)']
        }
      }
    });
    const { settings } = run(home);
    expect(settings.retiredGrants).toEqual([
      { list: 'allow', entry: 'Skill(agent-kevin:quick-pulse)', replacement: ['Skill(agent-kevin:briefing)'] },
      { list: 'ask', entry: 'Skill(agent-kevin:seed-import)', replacement: ['Skill(agent-kevin:seed)'] }
    ]);
    expect(settings.allowMissing).not.toContain('Skill(agent-kevin:seed)');
    expect(settings.allowMissing).not.toContain('Skill(agent-kevin:briefing)');
    expect(fresh.retiredGrants).toEqual([]);
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

  test('backfills the Python guard into deny unless the operator already decided the entry', () => {
    expect(fresh.denyMissing).toContain('Bash(pip install*)');
    const home = scratchHome({
      settings: { permissions: { allow: ['Bash(pip3 install*)'], deny: ['Bash(rm -rf *)', 'Bash(pip install*)'] } }
    });
    const { denyMissing } = run(home).settings;
    expect(denyMissing).not.toContain('Bash(pip install*)');
    expect(denyMissing).not.toContain('Bash(pip3 install*)');
    expect(denyMissing).toContain('Bash(python3 -m pip install*)');
  });

  test('backfills the core deny list only while the user settings carry no deny list of their own', () => {
    expect(fresh.denyMissing).toEqual(
      expect.arrayContaining(['Bash(sudo *)', 'Read(~/.ssh/id_*)', 'Bash(pip install*)'])
    );
    const curated = run(scratchHome(), ['--claude-dir', claudeDirWith({ permissions: { deny: ['Bash(make *)'] } })]);
    expect(curated.settings.denyMissing).not.toContain('Bash(sudo *)');
    expect(curated.settings.denyMissing).toContain('Bash(pip install*)');
  });

  test('reports the sandbox block only when neither the home nor the user settings decide it', () => {
    if (process.platform === 'win32') {
      expect(fresh.sandboxBlock).toBeNull();
      return;
    }
    expect(fresh.sandboxBlock).toMatchObject({ enabled: true, allowUnsandboxedCommands: false });
    expect(fresh.sandboxBlock.filesystem).not.toHaveProperty('allowWrite');
    const userOn = ['--claude-dir', claudeDirWith({ sandbox: { enabled: true } })];
    expect(run(scratchHome(), userOn).settings.sandboxBlock).toBeNull();
    expect(run(scratchHome({ settings: { sandbox: { enabled: false } } })).settings.sandboxBlock).toBeNull();
    expect(
      run(scratchHome({ settings: { sandbox: { network: { allowedDomains: ['pypi.org'] } } } })).settings.sandboxBlock
    ).not.toBeNull();
  });

  test('backfills the uv sandbox grants a home lacks, keeping its own entries', () => {
    expect(fresh.sandboxMissing).toEqual({
      allowWrite: ['~/.cache/uv'],
      allowedDomains: ['pypi.org', 'files.pythonhosted.org']
    });
    const home = scratchHome({
      settings: {
        sandbox: { filesystem: { allowWrite: ['~/.cache/uv'] }, network: { allowedDomains: ['github.com'] } }
      }
    });
    expect(run(home).settings.sandboxMissing).toEqual({
      allowWrite: [],
      allowedDomains: ['pypi.org', 'files.pythonhosted.org']
    });
  });

  test('plansDirectory follows the reports root inside the home, and is never set to a folder outside it', () => {
    expect(fresh.plansDirectory).toBe('./reports/plans');
    const inside = scratchHome();
    expect(run(inside, [], join(inside, 'out', 'reports')).settings.plansDirectory).toBe('./out/reports/plans');
    expect(run(scratchHome(), [], join(tmpdir(), 'elsewhere', 'reports')).settings.plansDirectory).toBeNull();
    const home = scratchHome({ settings: { plansDirectory: './.claude/plans' } });
    expect(run(home).settings.plansDirectory).toBeNull();
  });

  test('an entry kept in settings.local.json counts as present', () => {
    const report = run(
      scratchHome({
        local: {
          permissions: { allow: MISSING_GRANTS },
          sandbox: { enabled: false, filesystem: { allowWrite: ['~/.cache/uv'] } },
          plansDirectory: './.claude/plans'
        }
      })
    ).settings;
    MISSING_GRANTS.forEach((grant) => expect(report.allowMissing).not.toContain(grant));
    expect(report.sandboxBlock).toBeNull();
    expect(report.sandboxMissing.allowWrite).toEqual([]);
    expect(report.plansDirectory).toBeNull();
  });

  test('haikuModel sets a missing or retired Haiku-tier model and keeps an operator choice', () => {
    const haikuOf = (env?: object) => run(scratchHome({ settings: env ? { env } : {} })).settings.haikuModel;
    expect(fresh.haikuModel).toBe('claude-sonnet-5-5');
    expect(haikuOf({ CLAUDE_CODE_NO_FLICKER: '1' })).toBe('claude-sonnet-5-5');
    expect(haikuOf({ ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-6' })).toBe('claude-sonnet-5-5');
    expect(haikuOf({ ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-5-5' })).toBeNull();
    expect(haikuOf({ ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5' })).toBeNull();
  });
});

describe('home-baseline identity', () => {
  const withBaseline = (content: string): { home: string; file: string } => {
    const home = scratchHome();
    mkdirSync(join(home, '.kevin'));
    const file = join(home, '.kevin', 'version.json');
    writeFileSync(file, content);
    return { home, file };
  };
  const BASELINE = { templateVersion: '0.6.4', initializedAt: '2026-01-01', history: [] };

  test('records this plugin first in a baseline that lacks it, keeping every other field', () => {
    const { home, file } = withBaseline(JSON.stringify(BASELINE));
    expect(run(home, ['--write']).identity).toEqual({ state: 'stamped' });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ plugin: 'agent-kevin', ...BASELINE });
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf-8')))[0]).toBe('plugin');
    expect(run(home, ['--write']).identity).toEqual({ state: 'current' });
  });

  test('a dry run reports the missing record and writes nothing', () => {
    const before = JSON.stringify(BASELINE);
    const { home, file } = withBaseline(before);
    expect(run(home).identity).toEqual({ state: 'missing' });
    expect(readFileSync(file, 'utf-8')).toBe(before);
  });

  test('never rewrites a baseline recorded for another plugin', () => {
    const before = JSON.stringify({ plugin: 'agent-other', ...BASELINE });
    const { home, file } = withBaseline(before);
    expect(run(home, ['--write']).identity).toEqual({ state: 'mismatch', recorded: 'agent-other' });
    expect(readFileSync(file, 'utf-8')).toBe(before);
  });

  test('replaces a non-string plugin value', () => {
    const { home, file } = withBaseline(JSON.stringify({ ...BASELINE, plugin: 7 }));
    expect(run(home, ['--write']).identity).toEqual({ state: 'stamped' });
    expect(JSON.parse(readFileSync(file, 'utf-8')).plugin).toBe('agent-kevin');
  });

  test('leaves an unreadable baseline alone and creates none where there is none', () => {
    const { home, file } = withBaseline('not json');
    expect(run(home, ['--write']).identity).toEqual({ state: 'unreadable' });
    expect(readFileSync(file, 'utf-8')).toBe('not json');
    const bare = scratchHome();
    expect(run(bare, ['--write']).identity).toEqual({ state: 'no-baseline' });
    expect(existsSync(join(bare, '.kevin', 'version.json'))).toBe(false);
  });
});
