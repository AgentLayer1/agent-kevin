import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { agentHomePath, readEnvFile } from './env';

// KEVIN_HOME-dependent assertions run synchronously (no awaits) so the mutation
// never interleaves with pipeline.test.ts, which shares process.env.

describe('agentHomePath', () => {
  /** Run `fn` with KEVIN_HOME unset and cwd at `dir`, restoring both after. */
  const withCwd = <T>(dir: string, fn: () => T): T => {
    const originalHome = process.env.KEVIN_HOME;
    const originalCwd = process.cwd();
    delete process.env.KEVIN_HOME;
    process.chdir(dir);
    try {
      return fn();
    } finally {
      process.chdir(originalCwd);
      if (originalHome === undefined) {
        delete process.env.KEVIN_HOME;
      } else {
        process.env.KEVIN_HOME = originalHome;
      }
    }
  };

  test('KEVIN_HOME wins when set', () => {
    const original = process.env.KEVIN_HOME;
    process.env.KEVIN_HOME = '/some/agent/home';
    try {
      expect(agentHomePath()).toBe('/some/agent/home');
    } finally {
      if (original === undefined) {
        delete process.env.KEVIN_HOME;
      } else {
        process.env.KEVIN_HOME = original;
      }
    }
  });

  test('walks up to the nearest home carrying the agent data dir and writes it back to the env', () => {
    // realpath because macOS tmpdir is a symlink (/var → /private/var) and the
    // walk-up starts from the already-resolved process.cwd().
    const home = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-home-')));
    mkdirSync(resolve(home, '.kevin'));
    const repo = resolve(home, 'not-really-a-repo', 'src');
    mkdirSync(repo, { recursive: true });
    withCwd(repo, () => {
      expect(agentHomePath()).toBe(home);
      expect(process.env.KEVIN_HOME).toBe(home);
    });
  });

  test('ignores a sibling agent home that lacks this agent data dir', () => {
    const siblingHome = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-sibling-')));
    writeFileSync(resolve(siblingHome, 'SOUL.md'), '# Soul\n');
    mkdirSync(resolve(siblingHome, '.otheragent'));
    const inner = resolve(siblingHome, 'projects');
    mkdirSync(inner, { recursive: true });
    withCwd(inner, () => {
      expect(agentHomePath()).toBe(process.cwd());
      expect(process.env.KEVIN_HOME).toBeUndefined();
    });
  });

  test('falls back to cwd without writing the env when no home exists above', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'kevin-nohome-'));
    withCwd(dir, () => {
      expect(agentHomePath()).toBe(process.cwd());
      expect(process.env.KEVIN_HOME).toBeUndefined();
    });
  });
});

describe('readEnvFile', () => {
  test('parses a standalone .env into a map', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'kevin-flowenv-'));
    writeFileSync(resolve(dir, '.env'), '# comment\nCARD=4111111111111111\nCVV="123"\n\nEMPTY=\n');
    expect(readEnvFile(resolve(dir, '.env'))).toEqual({ CARD: '4111111111111111', CVV: '123', EMPTY: '' });
  });

  test('returns {} for an absent file', () => {
    expect(readEnvFile(resolve(tmpdir(), 'kevin-does-not-exist-xyz', '.env'))).toEqual({});
  });

  test('refuses to read the agent secret store, even when a real .env sits there', () => {
    const home = mkdtempSync(resolve(tmpdir(), 'kevin-home-'));
    const secretsPath = resolve(home, '.kevin', 'secrets', '.env');
    mkdirSync(resolve(home, '.kevin', 'secrets'), { recursive: true });
    writeFileSync(secretsPath, 'GITHUB_TOKEN=ghp_realsecretvalue\n');
    const flowPath = resolve(home, '.claude', 'browser-flows', 'x', '.env');
    mkdirSync(resolve(home, '.claude', 'browser-flows', 'x'), { recursive: true });
    writeFileSync(flowPath, 'CARD=4111111111111111\n');

    const original = process.env.KEVIN_HOME;
    process.env.KEVIN_HOME = home;
    try {
      expect(readEnvFile(secretsPath)).toEqual({});
      expect(readEnvFile(resolve(home, '.kevin', 'secrets', 'nested', '.env'))).toEqual({});
      expect(readEnvFile(flowPath)).toEqual({ CARD: '4111111111111111' });
    } finally {
      if (original === undefined) {
        delete process.env.KEVIN_HOME;
      } else {
        process.env.KEVIN_HOME = original;
      }
    }
  });
});
