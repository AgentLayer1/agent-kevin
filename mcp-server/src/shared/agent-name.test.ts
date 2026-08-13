import { agentDisplayName } from '@/shared/agent-name';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { RUNTIME_DIR_DEFAULT, agentKeyName } from '@/shared/naming';

/**
 * Run `fn` against a throwaway home whose `IDENTITY.md` holds `body` (omit to
 * leave the file absent). `AGENT_HOME` is restored afterwards, and this agent's
 * own `KEVIN_HOME` is cleared for the duration: it outranks `AGENT_HOME`, so an
 * operator's shell export would otherwise silently point these at a real brain.
 */
const withIdentity = <T>(body: string | undefined, fn: () => T): T => {
  const home = mkdtempSync(resolve(tmpdir(), 'agent-name-test-'));
  mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT), { recursive: true });
  if (body !== undefined) {
    writeFileSync(resolve(home, 'IDENTITY.md'), body);
  }
  const ownKey = agentKeyName('HOME');
  const priorHome = process.env.AGENT_HOME;
  const priorOwn = process.env[ownKey];
  process.env.AGENT_HOME = home;
  delete process.env[ownKey];
  try {
    return fn();
  } finally {
    if (priorHome === undefined) delete process.env.AGENT_HOME;
    else process.env.AGENT_HOME = priorHome;
    if (priorOwn !== undefined) process.env[ownKey] = priorOwn;
    rmSync(home, { recursive: true, force: true });
  }
};

const identity = (name: string): string => `# Identity\n\n## Who\n\n- **Name:** ${name}\n- **Emoji:** 🍌\n`;

describe('agentDisplayName', () => {
  test('reads a renamed agent from IDENTITY.md', () => {
    expect(withIdentity(identity('Vikrum'), agentDisplayName)).toBe('Vikrum');
  });

  test('multi-word names survive intact', () => {
    expect(withIdentity(identity('Ada Lovelace'), agentDisplayName)).toBe('Ada Lovelace');
  });

  test('falls back to the plugin name when the Name field is absent', () => {
    expect(withIdentity('# Identity\n\n## Who\n\n- **Kind:** AI assistant\n', agentDisplayName)).toBe('Kevin');
  });

  test('falls back when IDENTITY.md does not exist (pre-init home)', () => {
    expect(withIdentity(undefined, agentDisplayName)).toBe('Kevin');
  });

  test('an unsubstituted init token falls back instead of leaking the placeholder', () => {
    // A failed init leaves `{{AGENT_NAME}}` in the file. Rendering that verbatim
    // would put the raw token in the session banner, TASKS.md, and every compile
    // prompt — worse than showing the default.
    expect(withIdentity(identity('{{AGENT_NAME}}'), agentDisplayName)).toBe('Kevin');
  });

  test('is read live, so a rename takes effect without a restart', () => {
    const home = mkdtempSync(resolve(tmpdir(), 'agent-name-live-'));
    mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT), { recursive: true });
    const ownKey = agentKeyName('HOME');
    const priorHome = process.env.AGENT_HOME;
    const priorOwn = process.env[ownKey];
    process.env.AGENT_HOME = home;
    delete process.env[ownKey];
    try {
      writeFileSync(resolve(home, 'IDENTITY.md'), identity('Kevin'));
      expect(agentDisplayName()).toBe('Kevin');
      writeFileSync(resolve(home, 'IDENTITY.md'), identity('Vikrum'));
      expect(agentDisplayName()).toBe('Vikrum');
    } finally {
      if (priorHome === undefined) delete process.env.AGENT_HOME;
      else process.env.AGENT_HOME = priorHome;
      if (priorOwn !== undefined) process.env[ownKey] = priorOwn;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
