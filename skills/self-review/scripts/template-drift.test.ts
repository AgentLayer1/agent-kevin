import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'template-drift.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const tree = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'template-drift-'));
  dirs.push(root);
  Object.entries(files).forEach(([rel, content]) => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
  });
  return root;
};

const run = (home: string, plugin: string, extra: string[] = []) => {
  const proc = spawnSync(process.execPath, [SCRIPT, '--home', home, '--plugin', plugin, ...extra]);
  return JSON.parse(proc.stdout.toString());
};

describe('template-drift', () => {
  const plugin = tree({
    'templates/SOUL.md':
      '# Soul\n\n## Writing Style\n\n- Avoid em-dashes.\n\n## Boundaries\n\n- Private things stay private.\n',
    'templates/AGENTS.md': '# Manual\n\n## Workflow\n\n- {{AGENT_NAME}} ships before starting.\n',
    'templates/rules/swift.md': '# Swift\n\n- Prefer structs.\n'
  });

  test('reports the lines and sections a home has that its templates lack, matching placeholders to their values', () => {
    const home = tree({
      'SOUL.md':
        '# Soul\n\n## Writing Style\n\n- Avoid em-dashes.\n- Visual over wordy.\n\n## Boundaries\n\n- Private things stay private.\n\n## Hobbies\n\n- Sailing on weekends.\n',
      'AGENTS.md': '# Manual\n\n## Workflow\n\n- Ace ships before starting.\n- Run git remote -v first.\n',
      '.claude/rules/swift.md': '# Swift\n\n- Prefer structs.\n'
    });
    const out = run(home, plugin);
    const byFile = Object.fromEntries(out.files.map((file: { file: string }) => [file.file, file]));
    expect(byFile['SOUL.md'].homeOnlySections).toEqual(['Hobbies']);
    expect(byFile['SOUL.md'].homeOnlyLines).toEqual([
      { section: 'Writing Style', line: '- Visual over wordy.' },
      { section: 'Hobbies', line: '- Sailing on weekends.' }
    ]);
    expect(byFile['AGENTS.md'].homeOnlyLines).toEqual([{ section: 'Workflow', line: '- Run git remote -v first.' }]);
    expect(byFile['.claude/rules/swift.md'].homeOnlyLines).toEqual([]);
  });

  test('with a base, tells the old template wording from the operator lines', () => {
    const base = tree({
      'AGENTS.md': '# Manual\n\n## Workflow\n\n- {{AGENT_NAME}} ships.\n- Code lives under `~/Developer/<Org>/`.\n'
    });
    const home = tree({
      'AGENTS.md': '# Manual\n\n## Workflow\n\n- Ace ships.\n- Code lives under `~/Developer/Acme/`.\n- Run git remote -v first.\n'
    });
    const agents = run(home, plugin, ['--base', base]).files.find((file: { file: string }) => file.file === 'AGENTS.md');
    expect(agents.homeOnlyLines).toEqual([
      { section: 'Workflow', line: '- Ace ships.', inBase: true },
      { section: 'Workflow', line: '- Code lives under `~/Developer/Acme/`.', inBase: false },
      { section: 'Workflow', line: '- Run git remote -v first.', inBase: false }
    ]);
  });

  test('flags rule-shaped bullets in USER.md and the preferences facet', () => {
    const home = tree({
      'SOUL.md': '# Soul\n',
      'USER.md': '# About Ada\n\n- **Name:** Ada\n- Always link the task id after its name.\n',
      'knowledge/user/preferences.md': '# Preferences\n\n- Obsidian as the dashboard.\n- Never hand-edit a lockfile.\n'
    });
    expect(run(home, plugin).ruleLike).toEqual([
      { file: 'USER.md', line: '- Always link the task id after its name.' },
      { file: 'knowledge/user/preferences.md', line: '- Never hand-edit a lockfile.' }
    ]);
  });
});
