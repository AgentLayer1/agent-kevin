import { describe, expect, test } from 'bun:test';
import { RUNTIME_DIR_DEFAULT, agentEnvPrefix, agentKeyName, runtimeDirName } from './naming';

// Synchronous assertions (no awaits) so these process.env mutations never
// interleave with the other suites that share it.

/** Run `fn` with `vars` applied to process.env, restoring every one after. */
const withEnv = <T>(vars: Record<string, string>, fn: () => T): T => {
  const originals = Object.keys(vars).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [key, original] of originals) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  }
};

describe('agentEnvPrefix', () => {
  // The one place the fork name is asserted — every other test builds key names
  // from the prefix, so a fork updates this line and nothing else.
  test('derives KEVIN_ from this plugin manifest (agent-kevin)', () => {
    expect(agentEnvPrefix()).toBe('KEVIN_');
    expect(agentKeyName('CODE_PATH')).toBe('KEVIN_CODE_PATH');
  });
});

describe('runtimeDirName', () => {
  test('defaults to .kevin and honors the AGENT_RUNTIME_DIR override', () => {
    expect(runtimeDirName()).toBe(RUNTIME_DIR_DEFAULT);
    withEnv({ AGENT_RUNTIME_DIR: '.workspace' }, () => {
      expect(runtimeDirName()).toBe('.workspace');
    });
  });

  test("this agent's own spelling beats the shared AGENT_RUNTIME_DIR", () => {
    withEnv({ AGENT_RUNTIME_DIR: '.workspace', [agentKeyName('RUNTIME_DIR')]: '.kevin-own' }, () => {
      expect(runtimeDirName()).toBe('.kevin-own');
    });
  });

  // The value is joined onto HOME to locate the deny-gated secrets store, so a
  // path here would walk that store (and every guard keyed on it) out of the home.
  test.each(['/tmp/elsewhere', '../escape', '.', '..', '.kevin/secrets'])(
    'refuses the path-shaped override %p',
    (bad) => {
      withEnv({ AGENT_RUNTIME_DIR: bad }, () => {
        expect(() => runtimeDirName()).toThrow(/bare folder name/);
      });
    }
  );
});
