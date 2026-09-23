import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentKeyName, runtimeDirName } from '../../../mcp-server/src/shared/naming';

const SCRIPT = join(import.meta.dir, 'context-weight.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A scaffolded home: the bridge imports the manual and the identity stack. */
const home = () => {
  const root = mkdtempSync(join(tmpdir(), 'context-weight-'));
  dirs.push(root);
  const write = (rel: string, content: string) => {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  };
  write(join(runtimeDirName(), 'version.json'), '{}');
  write('AGENTS.md', '# Manual\n');
  write('SOUL.md', '# Soul\n');
  write('.claude/CLAUDE.md', '@../AGENTS.md\n@../SOUL.md\n');
  const run = () => {
    const proc = spawnSync(process.execPath, [SCRIPT, '--home', root]);
    return { status: proc.status, out: JSON.parse(proc.stdout.toString()) };
  };
  const claudeFiles = () =>
    run()
      .out.claude.files.map((file: { path: string }) => file.path.slice(root.length + 1))
      .sort();
  return { root, write, run, claudeFiles };
};

describe('context-weight', () => {
  test('the Claude stack is the bridge plus what it imports; Codex is the manual plus the static files', () => {
    const { run, claudeFiles } = home();
    expect(claudeFiles()).toEqual(['.claude/CLAUDE.md', 'AGENTS.md', 'SOUL.md']);
    const { status, out } = run();
    expect(status).toBe(0);
    expect(out.codex.files.map((file: { path: string }) => file.path.endsWith('AGENTS.md'))).toContain(true);
    expect(out.codex.unresolved).toEqual([]);
    expect(out.codex.absent.length).toBeGreaterThan(0);
  });

  test('an import inside prose counts; one inside a fence or a code span does not', () => {
    const { write, run, claudeFiles } = home();
    write('inline.md', 'x');
    write('README', 'r');
    write(
      '.claude/CLAUDE.md',
      'See @../inline.md for the rules (and @../README).\n\n```\n@../missing.md\n```\n\n~~~\n@../missing-too.md\n~~~\n\n  ~~~\n  @../indented.md\n  ~~~\n\n````\n@../four.md\n````\n\nNot `@../also-missing.md` either, and @Observable is a word.\n\n```\n@../unclosed.md\n'
    );
    expect(claudeFiles()).toEqual(['.claude/CLAUDE.md', 'README', 'inline.md']);
    expect(run().status).toBe(0);
  });

  test('--home wins over the cwd and the agent variable, whatever the prefix', () => {
    const { root, run } = home();
    const other = home();
    const proc = spawnSync(process.execPath, [SCRIPT, '--home', root], {
      cwd: other.root,
      env: { ...process.env, [agentKeyName('HOME')]: other.root }
    });
    expect(JSON.parse(proc.stdout.toString()).home).toBe(root);
    expect(run().out.home).toBe(root);
  });

  test('imports follow imports, and a missing target fails the run', () => {
    const { write, run, claudeFiles } = home();
    write('AGENTS.md', '@knowledge/index.md\n');
    write('knowledge/index.md', '@./gone.md\n');
    const { status, out } = run();
    expect(status).toBe(1);
    expect(out.claude.unresolved).toEqual([join(out.home, 'knowledge', 'gone.md')]);
    expect(claudeFiles()).toContain('knowledge/index.md');
  });

  test('rules count when unscoped, including in subdirectories; a paths: scope excludes them', () => {
    const { write, claudeFiles } = home();
    write('.claude/rules/global.md', '# always\n');
    write('.claude/rules/nested/deep.md', '---\ntitle: x\n---\n# always too\n');
    write('.claude/rules/scoped.md', '---\npaths: ["src/**"]\n---\n# only src\n');
    write('.claude/rules/spaced.md', '---\r\npaths : ["src/**"]\r\n---\r\n# only src\r\n');
    write('.claude/rules/quoted.md', '---\n"paths": ["src/**"]\n---\n# only src\n');
    write('.claude/rules/broken.md', '---\npaths: [unclosed\n---\n# loaded, frontmatter unreadable\n');
    expect(claudeFiles()).toEqual([
      '.claude/CLAUDE.md',
      '.claude/rules/broken.md',
      '.claude/rules/global.md',
      '.claude/rules/nested/deep.md',
      'AGENTS.md',
      'SOUL.md'
    ]);
  });
});
