import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { agentEnvPrefix, agentHomePath, agentKeyName, env, loadSecretsEnv, readEnvFile, runtimeDirName } from './env';

// AGENT_HOME-dependent assertions run synchronously (no awaits) so the mutation
// never interleaves with pipeline.test.ts, which shares process.env.

/** Run `fn` with both home spellings restored after, `mutate` applied first. */
const withHomeEnv = <T>(mutate: () => void, fn: () => T): T => {
  const originalOwn = process.env.KEVIN_HOME;
  const originalShared = process.env.AGENT_HOME;
  mutate();
  try {
    return fn();
  } finally {
    for (const [key, original] of [
      ['KEVIN_HOME', originalOwn],
      ['AGENT_HOME', originalShared]
    ] as const) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  }
};

describe('agentHomePath', () => {
  /** Run `fn` with both home vars unset and cwd at `dir`, restoring all after. */
  const withCwd = <T>(dir: string, fn: () => T): T => {
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      return withHomeEnv(() => {
        delete process.env.KEVIN_HOME;
        delete process.env.AGENT_HOME;
      }, fn);
    } finally {
      process.chdir(originalCwd);
    }
  };

  test('the shared AGENT_HOME resolves when set', () => {
    withHomeEnv(
      () => {
        delete process.env.KEVIN_HOME;
        process.env.AGENT_HOME = '/some/agent/home';
      },
      () => {
        expect(agentHomePath()).toBe('/some/agent/home');
      }
    );
  });

  test("this agent's override (KEVIN_HOME) beats the shared AGENT_HOME", () => {
    withHomeEnv(
      () => {
        process.env.AGENT_HOME = '/shared/base/home';
        process.env.KEVIN_HOME = '/kevin/own/home';
      },
      () => {
        expect(agentHomePath()).toBe('/kevin/own/home');
      }
    );
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
      expect(process.env.AGENT_HOME).toBe(home);
    });
  });

  test('the walk-up anchors on an AGENT_RUNTIME_DIR-overridden data dir', () => {
    const home = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-override-')));
    mkdirSync(resolve(home, '.workspace'));
    const inner = resolve(home, 'projects');
    mkdirSync(inner, { recursive: true });
    process.env.AGENT_RUNTIME_DIR = '.workspace';
    try {
      withCwd(inner, () => {
        expect(agentHomePath()).toBe(home);
      });
    } finally {
      delete process.env.AGENT_RUNTIME_DIR;
    }
  });

  test('ignores a sibling agent home that lacks this agent data dir', () => {
    const siblingHome = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-sibling-')));
    writeFileSync(resolve(siblingHome, 'SOUL.md'), '# Soul\n');
    mkdirSync(resolve(siblingHome, '.otheragent'));
    const inner = resolve(siblingHome, 'projects');
    mkdirSync(inner, { recursive: true });
    withCwd(inner, () => {
      expect(agentHomePath()).toBe(process.cwd());
      expect(process.env.AGENT_HOME).toBeUndefined();
    });
  });

  test('falls back to cwd without writing the env when no home exists above', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'kevin-nohome-'));
    withCwd(dir, () => {
      expect(agentHomePath()).toBe(process.cwd());
      expect(process.env.AGENT_HOME).toBeUndefined();
    });
  });
});

describe('agentEnvPrefix', () => {
  test('derives KEVIN_ from this plugin manifest (agent-kevin)', () => {
    expect(agentEnvPrefix()).toBe('KEVIN_');
    expect(agentKeyName('CODE_PATH')).toBe('KEVIN_CODE_PATH');
  });
});

describe('runtimeDirName', () => {
  test('defaults to .kevin and honors the AGENT_RUNTIME_DIR override', () => {
    expect(runtimeDirName()).toBe('.kevin');
    process.env.AGENT_RUNTIME_DIR = '.workspace';
    try {
      expect(runtimeDirName()).toBe('.workspace');
    } finally {
      delete process.env.AGENT_RUNTIME_DIR;
    }
  });

  test("this agent's KEVIN_RUNTIME_DIR beats the shared AGENT_RUNTIME_DIR", () => {
    process.env.AGENT_RUNTIME_DIR = '.workspace';
    process.env.KEVIN_RUNTIME_DIR = '.kevin-own';
    try {
      expect(runtimeDirName()).toBe('.kevin-own');
    } finally {
      delete process.env.AGENT_RUNTIME_DIR;
      delete process.env.KEVIN_RUNTIME_DIR;
    }
  });
});

describe('env per-agent override + segmentation', () => {
  test("this agent's KEVIN_* spelling beats the shared AGENT_* name", () => {
    process.env.AGENT_PROBE_OVERRIDE = 'shared';
    process.env.KEVIN_PROBE_OVERRIDE = 'own';
    try {
      expect(env('AGENT_PROBE_OVERRIDE')).toBe('own');
    } finally {
      delete process.env.AGENT_PROBE_OVERRIDE;
      delete process.env.KEVIN_PROBE_OVERRIDE;
    }
  });

  test('the shared AGENT_* name is used when no override is set', () => {
    process.env.AGENT_PROBE_OVERRIDE = 'shared';
    try {
      expect(env('AGENT_PROBE_OVERRIDE')).toBe('shared');
    } finally {
      delete process.env.AGENT_PROBE_OVERRIDE;
    }
  });

  test('segmented keys never resolve from the shared name', () => {
    process.env.AGENT_CODE_PATH = '/shared/code';
    try {
      expect(env('AGENT_CODE_PATH')).toBeUndefined();
      process.env.KEVIN_CODE_PATH = '/kevin/code';
      expect(env('AGENT_CODE_PATH')).toBe('/kevin/code');
    } finally {
      delete process.env.AGENT_CODE_PATH;
      delete process.env.KEVIN_CODE_PATH;
    }
  });

  test('non-AGENT_ keys get no override resolution', () => {
    expect(env('PROBE_OVERRIDE_UNSET_XYZ')).toBeUndefined();
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

    withHomeEnv(
      () => {
        process.env.AGENT_HOME = home;
      },
      () => {
        expect(readEnvFile(secretsPath)).toEqual({});
        expect(readEnvFile(resolve(home, '.kevin', 'secrets', 'nested', '.env'))).toEqual({});
        expect(readEnvFile(flowPath)).toEqual({ CARD: '4111111111111111' });
      }
    );
  });
});

describe('loadSecretsEnv', () => {
  /** A home whose secrets store holds `key=value`. */
  const homeWithSecret = (key: string, value: string): string => {
    const home = mkdtempSync(resolve(tmpdir(), 'kevin-secrets-'));
    mkdirSync(resolve(home, '.kevin', 'secrets'), { recursive: true });
    writeFileSync(resolve(home, '.kevin', 'secrets', '.env'), `${key}=${value}\n`, 'utf-8');
    return home;
  };

  // Synchronous, like the assertions above, so the AGENT_HOME mutation can't interleave with
  // the other suites sharing process.env.
  test('re-reads when AGENT_HOME changes instead of latching on the first home', () => {
    const original = process.env.AGENT_HOME;
    const first = homeWithSecret('AGENT_PROBE_SECRET', 'from-first-home');
    const second = homeWithSecret('AGENT_PROBE_SECRET', 'from-second-home');
    try {
      process.env.AGENT_HOME = first;
      loadSecretsEnv();
      expect(env('AGENT_PROBE_SECRET')).toBe('from-first-home');

      process.env.AGENT_HOME = second;
      expect(env('AGENT_PROBE_SECRET')).toBe('from-second-home');
    } finally {
      process.env.AGENT_HOME = original;
      loadSecretsEnv();
      delete process.env.AGENT_PROBE_SECRET;
    }
  });

  test("a home with no secrets store drops the previous home's keys", () => {
    const original = process.env.AGENT_HOME;
    const withSecret = homeWithSecret('AGENT_PROBE_SECRET', 'present');
    const bare = mkdtempSync(resolve(tmpdir(), 'kevin-bare-'));
    mkdirSync(resolve(bare, '.kevin'), { recursive: true });
    try {
      process.env.AGENT_HOME = withSecret;
      expect(env('AGENT_PROBE_SECRET')).toBe('present');

      process.env.AGENT_HOME = bare;
      expect(env('AGENT_PROBE_SECRET')).toBeUndefined();
    } finally {
      process.env.AGENT_HOME = original;
      loadSecretsEnv();
      delete process.env.AGENT_PROBE_SECRET;
    }
  });
});
