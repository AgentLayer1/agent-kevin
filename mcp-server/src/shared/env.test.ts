import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR_DEFAULT, agentKeyName } from './naming';
import { agentHomePath, env, loadSecretsEnv, readEnvFile } from './env';

/** Scaffold `dir/` as a marked agent data dir under `home` (what init produces). */
const scaffoldDataDir = (home: string, dir: string = RUNTIME_DIR_DEFAULT): void => {
  mkdirSync(resolve(home, dir), { recursive: true });
  writeFileSync(resolve(home, dir, HOME_MARKER_FILES[0]), '{}\n');
};

// AGENT_HOME-dependent assertions run synchronously (no awaits) so the mutation
// never interleaves with pipeline.test.ts, which shares process.env.

const OWN_HOME_KEY = agentKeyName('HOME');

/** Run `fn` with both home spellings restored after, `mutate` applied first. */
const withHomeEnv = <T>(mutate: () => void, fn: () => T): T => {
  const originalOwn = process.env[OWN_HOME_KEY];
  const originalShared = process.env.AGENT_HOME;
  mutate();
  try {
    return fn();
  } finally {
    for (const [key, original] of [
      [OWN_HOME_KEY, originalOwn],
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
  /** Run `fn` with both home vars unset, cwd at `dir`, and the host's project dir
   *  set to `projectDir` (unset when omitted) — all restored after. */
  const withCwd = <T>(dir: string, fn: () => T, projectDir?: string): T => {
    const originalCwd = process.cwd();
    const originalProject = process.env.CLAUDE_PROJECT_DIR;
    process.chdir(dir);
    try {
      return withHomeEnv(() => {
        delete process.env[OWN_HOME_KEY];
        delete process.env.AGENT_HOME;
        if (projectDir === undefined) {
          delete process.env.CLAUDE_PROJECT_DIR;
        } else {
          process.env.CLAUDE_PROJECT_DIR = projectDir;
        }
      }, fn);
    } finally {
      process.chdir(originalCwd);
      if (originalProject === undefined) {
        delete process.env.CLAUDE_PROJECT_DIR;
      } else {
        process.env.CLAUDE_PROJECT_DIR = originalProject;
      }
    }
  };

  test('the shared AGENT_HOME resolves when set', () => {
    withHomeEnv(
      () => {
        delete process.env[OWN_HOME_KEY];
        process.env.AGENT_HOME = '/some/agent/home';
      },
      () => {
        expect(agentHomePath()).toBe('/some/agent/home');
      }
    );
  });

  test(`this agent's override (${OWN_HOME_KEY}) beats the shared AGENT_HOME`, () => {
    withHomeEnv(
      () => {
        process.env.AGENT_HOME = '/shared/base/home';
        process.env[OWN_HOME_KEY] = '/agent/own/home';
      },
      () => {
        expect(agentHomePath()).toBe('/agent/own/home');
      }
    );
  });

  test('walks up to the nearest home carrying the agent data dir and writes it back to the env', () => {
    // realpath because macOS tmpdir is a symlink (/var → /private/var) and the
    // walk-up starts from the already-resolved process.cwd().
    const home = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-home-')));
    scaffoldDataDir(home);
    const repo = resolve(home, 'not-really-a-repo', 'src');
    mkdirSync(repo, { recursive: true });
    withCwd(repo, () => {
      expect(agentHomePath()).toBe(home);
      expect(process.env.AGENT_HOME).toBe(home);
    });
  });

  // The migration window: the override flips machine-wide before a home's
  // folder is renamed. The walk-up must still anchor on the default-named dir,
  // or the home resolves to cwd and the secrets gate lands under the wrong root.
  test('the walk-up still anchors on the default data dir while the override points elsewhere', () => {
    const home = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-window-')));
    scaffoldDataDir(home);
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

  test('the walk-up anchors on an AGENT_RUNTIME_DIR-overridden data dir', () => {
    const home = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-override-')));
    scaffoldDataDir(home, '.workspace');
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

  // The forged-marker regression: a pre-guard logger once planted `.kevin/logs/`
  // in a worktree, and the bare dir then anchored every later hook there —
  // session captures landed inside the repo. Runtime artifacts alone must never
  // mark a home; only init's state files do.
  test('a data dir holding only runtime artifacts (logs/) does not anchor the walk-up', () => {
    const repo = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-planted-')));
    mkdirSync(resolve(repo, RUNTIME_DIR_DEFAULT, 'logs'), { recursive: true });
    writeFileSync(resolve(repo, RUNTIME_DIR_DEFAULT, 'logs', 'app.log'), 'skip line\n');
    withCwd(repo, () => {
      expect(agentHomePath()).toBe(process.cwd());
      expect(process.env.AGENT_HOME).toBeUndefined();
    });
  });

  // A session that `cd`s into a worktree keeps that cwd for every later hook —
  // the launch dir is what still points at the home.
  test("falls back to the host's project dir when cwd has roamed outside the home", () => {
    const home = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-roamed-')));
    scaffoldDataDir(home);
    const worktree = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-worktree-')));
    withCwd(
      worktree,
      () => {
        expect(agentHomePath()).toBe(home);
        expect(process.env.AGENT_HOME).toBe(home);
      },
      home
    );
  });

  test('a project dir that is not this agent home rescues nothing', () => {
    const worktree = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-worktree-')));
    const otherProject = realpathSync(mkdtempSync(resolve(tmpdir(), 'kevin-other-')));
    withCwd(
      worktree,
      () => {
        expect(agentHomePath()).toBe(process.cwd());
        expect(process.env.AGENT_HOME).toBeUndefined();
      },
      otherProject
    );
  });
});

describe('env per-agent override', () => {
  test("this agent's own spelling beats the shared AGENT_* name", () => {
    process.env.AGENT_PROBE_OVERRIDE = 'shared';
    process.env[agentKeyName('PROBE_OVERRIDE')] = 'own';
    try {
      expect(env('AGENT_PROBE_OVERRIDE')).toBe('own');
    } finally {
      delete process.env.AGENT_PROBE_OVERRIDE;
      delete process.env[agentKeyName('PROBE_OVERRIDE')];
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
    const secretsPath = resolve(home, RUNTIME_DIR_DEFAULT, 'secrets', '.env');
    mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT, 'secrets'), { recursive: true });
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
        expect(readEnvFile(resolve(home, RUNTIME_DIR_DEFAULT, 'secrets', 'nested', '.env'))).toEqual({});
        expect(readEnvFile(flowPath)).toEqual({ CARD: '4111111111111111' });
      }
    );
  });

  // The migration window: the runtime-dir name flips machine-wide before a given
  // home's folder is renamed, so the store still sitting under the default name
  // must stay gated — otherwise a flow .env path reads the agent's own keys.
  test('still refuses the default secret store while the runtime dir points elsewhere', () => {
    const home = mkdtempSync(resolve(tmpdir(), 'kevin-migrating-'));
    const secretsPath = resolve(home, RUNTIME_DIR_DEFAULT, 'secrets', '.env');
    mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT, 'secrets'), { recursive: true });
    writeFileSync(secretsPath, 'GITHUB_TOKEN=ghp_realsecretvalue\n');

    withHomeEnv(
      () => {
        process.env.AGENT_HOME = home;
        process.env.AGENT_RUNTIME_DIR = '.workspace';
      },
      () => {
        try {
          expect(readEnvFile(secretsPath)).toEqual({});
        } finally {
          delete process.env.AGENT_RUNTIME_DIR;
        }
      }
    );
  });
});

describe('loadSecretsEnv', () => {
  /** A home whose secrets store holds `key=value`. */
  const homeWithSecret = (key: string, value: string): string => {
    const home = mkdtempSync(resolve(tmpdir(), 'kevin-secrets-'));
    mkdirSync(resolve(home, RUNTIME_DIR_DEFAULT, 'secrets'), { recursive: true });
    writeFileSync(resolve(home, RUNTIME_DIR_DEFAULT, 'secrets', '.env'), `${key}=${value}\n`, 'utf-8');
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
    mkdirSync(resolve(bare, RUNTIME_DIR_DEFAULT), { recursive: true });
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
