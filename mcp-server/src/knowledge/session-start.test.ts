import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR_DEFAULT, agentKeyName } from '@/shared/naming';
import { sessionStart } from '@/knowledge/session-start';

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
    // SOUL.md / IDENTITY.md / USER.md / CLAUDE.md, so steering there loses the
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
