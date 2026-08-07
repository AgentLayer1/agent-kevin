/**
 * Config's two standing invariants.
 *
 * 1. Paths resolve live, never frozen at import. `FOLDERS`/`FILES` used to be computed once
 *    when the first module imported config, so whichever module got there first decided every
 *    path for the whole process. Anything that set `AGENT_HOME` afterwards — a hook, the CLI, a
 *    test fixture — was silently ignored, which meant an unrelated import in an early-loading
 *    test file could point a suite at the operator's real brain and have it write session
 *    captures there.
 * 2. `process.env` is read in one place. See the second describe block.
 *
 * `AGENT_HOME` mutations here stay synchronous (no awaits) so they can't interleave with the
 * other suites that share `process.env` — same discipline as `shared/env.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { FILES, FOLDERS } from '@/config';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROBE = '/tmp/kevin-config-probe';

/** Run `fn` with `AGENT_HOME` pointed at `home`, restoring the real value after. */
const withHome = <T>(home: string, fn: () => T): T => {
  const original = process.env.AGENT_HOME;
  process.env.AGENT_HOME = home;
  try {
    return fn();
  } finally {
    process.env.AGENT_HOME = original;
  }
};

describe('config path resolution', () => {
  test('FOLDERS follows an AGENT_HOME changed after import', () => {
    const before = FOLDERS.SESSIONS;
    withHome(PROBE, () => {
      expect(FOLDERS.SESSIONS).toBe(`${PROBE}/knowledge/raw/sessions`);
      expect(FOLDERS.DATA).toBe(`${PROBE}/.kevin`);
    });
    expect(FOLDERS.SESSIONS).toBe(before);
  });

  test('FILES follows it too, including the paths that get written to', () => {
    withHome(PROBE, () => {
      expect(FILES.SESSION_INDEX).toBe(`${PROBE}/knowledge/raw/sessions/index.json`);
      expect(FILES.KNOWLEDGE_STATE).toBe(`${PROBE}/.kevin/knowledge.json`);
      expect(FILES.SOUL).toBe(`${PROBE}/SOUL.md`);
    });
  });

  test('plugin-relative paths are fixed, not home-derived', () => {
    const templates = FOLDERS.TEMPLATES;
    withHome(PROBE, () => {
      expect(FOLDERS.TEMPLATES).toBe(templates);
    });
  });

  test('the preload pinned this suite to a throwaway home', () => {
    expect(FOLDERS.HOME).toContain('kevin-test-home-');
  });
});

/**
 * Convention guard: `process.env` is read in exactly one place — `shared/env.ts`, which exposes
 * `env()` / `dbConnections()` / `scrubValues()` to the rest of the codebase. That module
 * self-loads the home's `secrets/.env` before any read, so secrets loading is order-independent
 * instead of depending on which file imported config first. Three modules are exempt, all of
 * them BELOW that gate: `shared/naming.ts` owns the shared/override resolution rule the
 * gate is built from; `shared/log.ts` is a logger that must stay off the secrets path; and
 * `test.ts` pins `AGENT_HOME` before any module loads, since importing `@/shared/env` there
 * would self-load secrets from the un-pinned home — the exact thing it exists to prevent. The
 * `...process.env` spread (forwarding the env to a spawned child) is allowed everywhere — only
 * value reads (`process.env.X` / `process.env[x]`) are banned. See shared/env.ts.
 */
const SRC = resolve(import.meta.dir);
const ALLOWED = new Set(['shared/naming.ts', 'shared/env.ts', 'shared/log.ts', 'test.ts']);

const sourceFiles = readdirSync(SRC, { recursive: true, encoding: 'utf-8' })
  .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.includes('generated/'))
  .map((path) => path.replaceAll('\\', '/'))
  .filter((path) => !ALLOWED.has(path));

const READ_PATTERN = /process\.env\s*[.[]/;

describe('process.env is consolidated into shared/env.ts', () => {
  test('no module outside the naming/env/log/test floor reads process.env directly', () => {
    const offenders = sourceFiles.filter((path) => READ_PATTERN.test(readFileSync(resolve(SRC, path), 'utf-8')));
    expect(
      offenders,
      `Read env via @/shared/env (env()/dbConnections()) instead of process.env in: ${offenders.join(', ')}`
    ).toEqual([]);
  });
});
