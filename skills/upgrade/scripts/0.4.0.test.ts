/**
 * The 0.4.0 manual migration, exercised end to end against mkdtemp homes
 * (never live data) with the plugin's real templates/.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '0.4.0.ts');
const PLUGIN_ROOT = resolve(import.meta.dir, '..', '..', '..');

const legacyManual = (knowledge = 'knowledge', projects = 'projects', name = 'Scout'): string => `@SOUL.md
@IDENTITY.md
@USER.md
@${knowledge}/index.md
@${knowledge}/memory/index.md
@${projects}/TASKS.md

# CLAUDE.md — ${name}'s Operating Manual

Claude Code auto-loads this file from the agent home directory at session start. The \`@-imports\` above pull ${name}'s identity stack into context.

## Context Loading

**Static (auto-loaded by Claude Code via \`@-imports\`):**

1. **SOUL.md** — ${name}'s character

## Memory Routing

| Kind | Write to |
|------|----------|
| Feedback | \`${knowledge}/raw/user/feedback.md\` |

## Team Conventions

Operator-personal section. Keep every byte: acme, \`~/Developer/acme\`.

## Engineering Standards

### Comments

Default: none.
`;

const homes: string[] = [];
const makeHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'migrate-040-'));
  homes.push(home);
  mkdirSync(join(home, '.kevin'), { recursive: true });
  return home;
};
const write = (home: string, rel: string, content: string): void => {
  mkdirSync(resolve(home, rel, '..'), { recursive: true });
  writeFileSync(join(home, rel), content);
};
const read = (home: string, rel: string): string => readFileSync(join(home, rel), 'utf-8');

interface Run {
  code: number | null;
  report: Record<string, unknown>;
  stderr: string;
}
const run = (home: string, env: Record<string, string> = {}): Run => {
  // Strip every home/plugin override so an operator's shell can never point the
  // migration at a real brain from inside the test.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(KEVIN|AGENT)_(HOME|PLUGIN_ROOT|RUNTIME_DIR|KNOWLEDGE|PROJECTS)$/.test(key)
    )
  );
  const proc = spawnSync(process.execPath, [SCRIPT], {
    env: { ...inherited, AGENT_HOME: home, AGENT_PLUGIN_ROOT: PLUGIN_ROOT, ...env },
    encoding: 'utf-8'
  });
  const last = proc.stdout.trim().split('\n').pop() ?? '{}';
  return { code: proc.status, report: JSON.parse(last) as Record<string, unknown>, stderr: proc.stderr };
};

afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

describe('0.4.0 manual migration', () => {
  test('moves a legacy root CLAUDE.md to AGENTS.md and writes the bridge', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', legacyManual());
    write(home, 'IDENTITY.md', '# Identity\n\n## Who\n\n- **Name:** Scout\n');

    const { code, report } = run(home);
    expect(code).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.action).toBe('migrated');
    expect(report.source).toBe('CLAUDE.md');
    expect(report.removed).toEqual(['CLAUDE.md']);
    expect(report.agentName).toBe('Scout');
    expect(report.knowledgeRoot).toBe('knowledge');

    const agents = read(home, 'AGENTS.md');
    expect(agents.startsWith("# AGENTS.md — Scout's Operating Manual\n")).toBe(true);
    expect(agents).not.toMatch(/^@/m);
    expect(agents).not.toContain('Claude Code auto-loads this file');
    expect(agents).toContain('## Context Loading');
    expect(agents).toContain(
      '## Team Conventions\n\nOperator-personal section. Keep every byte: acme, `~/Developer/acme`.'
    );
    expect(agents).toContain('### Comments\n\nDefault: none.');
    expect(agents).not.toContain('{{');

    const bridge = read(home, '.claude/CLAUDE.md');
    for (const line of [
      '@../AGENTS.md',
      '@../SOUL.md',
      '@../IDENTITY.md',
      '@../USER.md',
      '@../knowledge/index.md',
      '@../knowledge/memory/index.md',
      '@../projects/TASKS.md',
      '# CLAUDE.md — Claude Code bridge for Scout'
    ]) {
      expect(bridge).toContain(line);
    }
    expect(bridge).not.toContain('{{');

    expect(existsSync(join(home, 'CLAUDE.md'))).toBe(false);
    const backup = join(home, String(report.backup));
    expect(readFileSync(join(backup, 'CLAUDE.md'), 'utf-8')).toBe(legacyManual());
  });

  test('is a no-op on a second run', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', legacyManual());
    expect(run(home).report.action).toBe('migrated');
    const agents = read(home, 'AGENTS.md');
    const bridge = read(home, '.claude/CLAUDE.md');
    const updates = readdirSync(join(home, '.kevin', 'updates'));

    const again = run(home);
    expect(again.code).toBe(0);
    expect(again.report.action).toBe('already-migrated');
    expect(read(home, 'AGENTS.md')).toBe(agents);
    expect(read(home, '.claude/CLAUDE.md')).toBe(bridge);
    expect(readdirSync(join(home, '.kevin', 'updates'))).toEqual(updates);
  });

  test('collision home: migrates CLAUDE.local.md and leaves the project CLAUDE.md alone', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', '# My project\n\nProject instructions, not the agent.\n');
    write(home, 'CLAUDE.local.md', legacyManual());

    const { report } = run(home);
    expect(report.ok).toBe(true);
    expect(report.source).toBe('CLAUDE.local.md');
    expect(report.removed).toEqual(['CLAUDE.local.md']);
    expect(read(home, 'CLAUDE.md')).toBe('# My project\n\nProject instructions, not the agent.\n');
    expect(existsSync(join(home, 'CLAUDE.local.md'))).toBe(false);
    expect(read(home, 'AGENTS.md')).toContain('## Team Conventions');
    expect(String(report.notes)).toContain('Your own CLAUDE.md stays at the home root');
  });

  test('relocated roots: absolute paths are imported as-is', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', legacyManual('/Volumes/brain/knowledge', '/Volumes/brain/projects'));

    const { report } = run(home);
    expect(report.knowledgeRoot).toBe('/Volumes/brain/knowledge');
    const bridge = read(home, '.claude/CLAUDE.md');
    expect(bridge).toContain('@/Volumes/brain/knowledge/index.md');
    expect(bridge).toContain('@/Volumes/brain/knowledge/memory/index.md');
    expect(bridge).toContain('@/Volumes/brain/projects/TASKS.md');
    expect(bridge).not.toContain('@../Volumes');
  });

  test('a project AGENTS.md that is not the manual gets the manual appended', () => {
    const home = makeHome();
    write(home, 'AGENTS.md', '# Project guide\n\nHow this repo works.\n');
    write(home, 'CLAUDE.md', legacyManual());

    const { report } = run(home);
    expect(report.ok).toBe(true);
    const agents = read(home, 'AGENTS.md');
    expect(agents.startsWith('# Project guide\n\nHow this repo works.\n\n# AGENTS.md — Scout')).toBe(true);
    expect(agents).toContain('## Memory Routing');
    expect(String(report.notes)).toContain('appended below the existing content');
    expect(existsSync(join(home, 'CLAUDE.md'))).toBe(false);
  });

  test('IDENTITY.md names the agent, not the legacy title', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', legacyManual('knowledge', 'projects', 'Scout'));
    write(home, 'IDENTITY.md', '# Identity\n\n## Who\n\n- **Name:** Vikrum\n');

    const { report } = run(home);
    expect(report.agentName).toBe('Vikrum');
    expect(read(home, 'AGENTS.md')).toContain("# AGENTS.md — Vikrum's Operating Manual");
    expect(read(home, '.claude/CLAUDE.md')).toContain('bridge for Vikrum');
  });

  test('a partial earlier run (AGENTS.md written, legacy file left) is completed without merging', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', legacyManual());
    run(home);
    const agents = read(home, 'AGENTS.md');
    write(home, 'CLAUDE.md', legacyManual());

    const { report } = run(home);
    expect(report.ok).toBe(true);
    expect(report.removed).toEqual(['CLAUDE.md']);
    expect(read(home, 'AGENTS.md')).toBe(agents);
    expect(String(report.notes)).toContain('backed up and removed without merging');
  });

  test('a CRLF manual migrates cleanly and keeps its line endings', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', legacyManual().replace(/\n/g, '\r\n'));

    const { report } = run(home);
    expect(report.ok).toBe(true);
    const agents = read(home, 'AGENTS.md');
    expect(agents.startsWith("# AGENTS.md — Scout's Operating Manual\r\n")).toBe(true);
    expect(agents.match(/^# /gm)).toHaveLength(1);
    expect(agents).not.toContain('Claude Code auto-loads this file');
    expect(agents).toContain('## Team Conventions\r\n\r\nOperator-personal section.');
    expect(agents).not.toMatch(/[^\r]\n/);
  });

  test('retargets links to the moved manual and the USER.md template sentence, leaves prose alone', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', legacyManual());
    write(
      home,
      'USER.md',
      'Scout reads this every session (via `@-import` in `CLAUDE.md`). Rules live in [CLAUDE.md](CLAUDE.md) and [the manual](./CLAUDE.md).\n'
    );
    write(
      home,
      'knowledge/concepts/x.md',
      'See [the manual](../../CLAUDE.md#task-system) and [soul](../../SOUL.md). Historically CLAUDE.md held it.\n'
    );
    write(home, 'knowledge/raw/sessions/2026-01-01.md', 'transcript mentions [CLAUDE.md](../../../CLAUDE.md)\n');
    write(home, 'projects/acme/tasks/ac-001.md', 'task links [CLAUDE.md](../../../CLAUDE.md)\n');

    const { report } = run(home);
    expect(report.ok).toBe(true);
    expect(report.linksRewritten).toEqual(['USER.md', 'knowledge/concepts/x.md']);
    expect(report.userSentenceRetargeted).toBe(true);
    expect(read(home, 'USER.md')).toBe(
      'Scout reads this every session (it is part of the identity stack loaded at session start). Rules live in [AGENTS.md](AGENTS.md) and [the manual](AGENTS.md).\n'
    );
    expect(read(home, 'knowledge/concepts/x.md')).toBe(
      'See [the manual](../../AGENTS.md#task-system) and [soul](../../SOUL.md). Historically CLAUDE.md held it.\n'
    );
    expect(read(home, 'knowledge/raw/sessions/2026-01-01.md')).toContain('(../../../CLAUDE.md)');
    expect(read(home, 'projects/acme/tasks/ac-001.md')).toContain('(../../../CLAUDE.md)');
  });

  test('a comment above the import header does not lose the relocated roots', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', '<!-- managed by me -->\n' + legacyManual('/Volumes/brain/knowledge', 'projects'));

    const { report } = run(home);
    expect(report.ok).toBe(true);
    expect(report.knowledgeRoot).toBe('/Volumes/brain/knowledge');
    const bridge = read(home, '.claude/CLAUDE.md');
    expect(bridge).toContain('@/Volumes/brain/knowledge/memory/index.md');
    expect(bridge.match(/^@/gm)).toHaveLength(7);
    const agents = read(home, 'AGENTS.md');
    expect(agents).not.toMatch(/^@/m);
    expect(agents).toContain('<!-- managed by me -->');
  });

  test('operator @-imports move into the bridge, re-rooted, never into AGENTS.md', () => {
    const home = makeHome();
    const legacy = legacyManual()
      .replace('@projects/TASKS.md\n', '@projects/TASKS.md\n@knowledge/user/preferences.md\n')
      .replace(
        "# CLAUDE.md — Scout's Operating Manual\n",
        "# CLAUDE.md — Scout's Operating Manual\n\n@/Volumes/shared/team-rules.md\n"
      );
    write(home, 'CLAUDE.md', legacy);

    const { report } = run(home);
    expect(report.ok).toBe(true);
    const bridge = read(home, '.claude/CLAUDE.md');
    expect(bridge).toContain(
      '@../projects/TASKS.md\n@../knowledge/user/preferences.md\n@/Volumes/shared/team-rules.md\n\n# CLAUDE.md'
    );
    const agents = read(home, 'AGENTS.md');
    expect(agents).not.toContain('preferences.md');
    expect(agents).not.toContain('team-rules.md');
    expect(agents).not.toMatch(/^@/m);
    expect(String(report.notes)).toContain('moved from the manual into .claude/CLAUDE.md');
  });

  test('a failed verification rolls back every write and leaves the legacy manual in place', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', legacyManual());
    write(home, 'AGENTS.md', '# Project guide\n\nA repo file the manual would join.\n');
    // A plugin whose bridge template lacks a required import line makes the bridge verify fail.
    const plugin = mkdtempSync(join(tmpdir(), 'migrate-040-plugin-'));
    homes.push(plugin);
    mkdirSync(join(plugin, 'templates'), { recursive: true });
    writeFileSync(
      join(plugin, 'templates', 'AGENTS.md'),
      readFileSync(join(PLUGIN_ROOT, 'templates', 'AGENTS.md'), 'utf-8')
    );
    writeFileSync(
      join(plugin, 'templates', 'CLAUDE.md'),
      readFileSync(join(PLUGIN_ROOT, 'templates', 'CLAUDE.md'), 'utf-8').replace('@../SOUL.md\n', '')
    );

    const { code, report } = run(home, { AGENT_PLUGIN_ROOT: plugin });
    expect(code).toBe(1);
    expect(String(report.error)).toContain('lacks @../SOUL.md');
    expect(String(report.error)).toContain('Nothing changed');
    expect(read(home, 'CLAUDE.md')).toBe(legacyManual());
    expect(read(home, 'AGENTS.md')).toBe('# Project guide\n\nA repo file the manual would join.\n');
    expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(false);
  });

  test('fails loud when no manual exists, touching nothing', () => {
    const home = makeHome();
    write(home, 'CLAUDE.md', '# Just a project file\n');

    const { code, report } = run(home);
    expect(code).toBe(1);
    expect(report.ok).toBe(false);
    expect(String(report.error)).toContain('no operating manual found');
    expect(existsSync(join(home, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(false);
    expect(read(home, 'CLAUDE.md')).toBe('# Just a project file\n');
  });
});
