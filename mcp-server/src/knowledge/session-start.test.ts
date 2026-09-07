import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { FOLDERS, staticContextFiles } from '@/config';
import { HOME_MARKER_FILES, RUNTIME_DIR_DEFAULT, agentKeyName } from '@/shared/naming';
import { sessionStart, sessionStartCodex } from '@/knowledge/session-start';

/**
 * Run `fn` against a throwaway home built by `setup`. This agent's own
 * `KEVIN_HOME` is cleared for the duration — it outranks `AGENT_HOME`, so an
 * operator's shell export would otherwise point these at a real brain.
 */
const withHome = async <T>(setup: (home: string) => void, fn: () => Promise<T>): Promise<T> => {
  const home = mkdtempSync(resolve(tmpdir(), 'session-start-test-'));
  setup(home);
  const ownKey = agentKeyName('HOME');
  const priorHome = process.env.AGENT_HOME;
  const priorOwn = process.env[ownKey];
  process.env.AGENT_HOME = home;
  delete process.env[ownKey];
  try {
    return await fn();
  } finally {
    if (priorHome === undefined) delete process.env.AGENT_HOME;
    else process.env.AGENT_HOME = priorHome;
    if (priorOwn !== undefined) process.env[ownKey] = priorOwn;
    rmSync(home, { recursive: true, force: true });
  }
};

describe('sessionStart', () => {
  test('an empty directory is pre-init and points at init', async () => {
    const result = await withHome(
      () => {},
      () => sessionStart()
    );
    expect(result.systemMessage).toContain(':init');
    expect(result.error).toBeUndefined();
  });

  test('SOUL.md without the data dir is stranded, and never suggests init', async () => {
    // The destructive case: a brain restored without its data dir, or a session
    // launched in a sibling agent's home. Init's re-run path offers to overwrite
    // SOUL.md / IDENTITY.md / USER.md / the manual, so steering there loses the
    // operator's agent instead of repairing it.
    const result = await withHome(
      (home) => writeFileSync(resolve(home, 'SOUL.md'), '# Soul'),
      () => sessionStart()
    );
    expect(result.systemMessage).toContain('Do NOT run init');
    expect(result.systemMessage).toContain(RUNTIME_DIR_DEFAULT);
    expect(result.additionalContext).toContain("another agent's home");
    expect(result.hasIssues).toBe(true);
    expect(result.error).toBeUndefined();
  });

  const markedHome = (home: string, files: Record<string, string>): void => {
    mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT), { recursive: true });
    writeFileSync(resolve(home, RUNTIME_DIR_DEFAULT, HOME_MARKER_FILES[0]), '{}');
    mkdirSync(resolve(home, '.claude'), { recursive: true });
    for (const [rel, content] of Object.entries(files)) writeFileSync(resolve(home, rel), content);
  };

  test('a migrated home with the bridge in place raises no layout warning', async () => {
    const result = await withHome(
      (home) =>
        markedHome(home, { 'AGENTS.md': '# AGENTS.md\n\n## Memory Routing\n', '.claude/CLAUDE.md': '@../AGENTS.md\n' }),
      () => sessionStart()
    );
    expect(result.additionalContext).not.toContain('Operating manual layout');
  });

  test('AGENTS.md without the bridge is flagged every session', async () => {
    const result = await withHome(
      (home) => markedHome(home, { 'AGENTS.md': '# AGENTS.md\n\n## Memory Routing\n' }),
      () => sessionStart()
    );
    expect(result.hasIssues).toBe(true);
    expect(result.additionalContext).toContain('Operating manual layout');
    expect(result.additionalContext).toContain('is missing, so Claude Code loads neither');
  });

  test('a pre-0.4.0 root CLAUDE.md beside AGENTS.md is flagged as a double load', async () => {
    const result = await withHome(
      (home) =>
        markedHome(home, {
          'AGENTS.md': '# AGENTS.md\n\n## Memory Routing\n',
          '.claude/CLAUDE.md': '@../AGENTS.md\n',
          'CLAUDE.md': '@SOUL.md\n\n# CLAUDE.md\n\n## Memory Routing\n'
        }),
      () => sessionStart()
    );
    expect(result.additionalContext).toContain('loads twice');
  });

  test("a project's own root CLAUDE.md beside AGENTS.md is not a double load", async () => {
    const result = await withHome(
      (home) =>
        markedHome(home, {
          'AGENTS.md': '# AGENTS.md\n\n## Memory Routing\n',
          '.claude/CLAUDE.md': '@../AGENTS.md\n',
          'CLAUDE.md': '# My project rules\n'
        }),
      () => sessionStart()
    );
    expect(result.additionalContext).not.toContain('Operating manual layout');
  });

  test('codex protocol: the payload carries the identity files with file markers and the dynamic lane', async () => {
    const first = await withHome(
      (home) =>
        markedHome(home, {
          'AGENTS.md': '# AGENTS.md\n\n## Memory Routing\n',
          '.claude/CLAUDE.md': '@../AGENTS.md\n',
          'SOUL.md': '# Soul\n\nSharp, a little spicy.\n',
          'IDENTITY.md': '# Identity\n\n## Who\n\n- **Name:** Scout\n',
          'USER.md': '# About Ada\n'
        }),
      () => sessionStartCodex()
    );
    expect(first).toContain('kevin static context · harness: codex');
    expect(first).toContain('<!-- file: SOUL.md -->');
    expect(first).toContain('Sharp, a little spicy.');
    expect(first).toContain('<!-- file: IDENTITY.md -->');
    expect(first).toContain('<!-- file: USER.md -->');
    expect(first).toContain('<!-- session context (dynamic lane) -->');
    expect(first).not.toContain('AGENTS.md —'); // the manual is Codex-native, never re-sent
  });

  test('the Codex stack is exactly what the Claude bridge template imports after the manual', () => {
    const template = readFileSync(resolve(import.meta.dir, '..', '..', '..', 'templates', 'CLAUDE.md'), 'utf-8');
    const imported = template
      .split('\n')
      .filter((line) => line.startsWith('@') && !line.endsWith('/AGENTS.md'))
      .map((line) =>
        line
          .slice(1)
          .replace('{{KNOWLEDGE_IMPORT}}', FOLDERS.KNOWLEDGE)
          .replace('{{PROJECTS_IMPORT}}', FOLDERS.PROJECTS)
          .replace(/^\.\.\//, `${FOLDERS.HOME}/`)
      )
      .map((path) => resolve(path));
    expect(staticContextFiles().map((path) => resolve(path))).toEqual(imported);
  });

  test('codex protocol: a pre-init directory gets the setup hint', async () => {
    const hint = await withHome(
      () => {},
      () => sessionStartCodex()
    );
    expect(hint).toContain('init');
  });

  test('the home marker alone marks the home, with no SOUL.md needed', async () => {
    const result = await withHome(
      (home) => {
        mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT), { recursive: true });
        writeFileSync(resolve(home, RUNTIME_DIR_DEFAULT, HOME_MARKER_FILES[0]), '{}\n');
      },
      () => sessionStart()
    );
    // Post-init path: a real banner, and none of the two setup messages.
    expect(result.systemMessage).not.toContain('Do NOT run init');
    expect(result.systemMessage).not.toContain('Not set up yet');
    expect(result.error).toBeUndefined();
  });
});
