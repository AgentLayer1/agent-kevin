import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// No @/config import: this file runs concurrently with pipeline.test.ts, which
// owns the config singleton's hermetic KEVIN_HOME. The plugin root is derived
// from this file's location; the migration runs in its own process (spawnSync).
const PLUGIN_ROOT = resolve(import.meta.dir, '..', '..', '..');
const scriptPath = resolve(PLUGIN_ROOT, 'skills', 'upgrade', 'scripts', '0.3.0.ts');

const seedHome = (): string => {
  const home = mkdtempSync(resolve(tmpdir(), 'kevin-mig-'));
  mkdirSync(resolve(home, '.claude'), { recursive: true });
  mkdirSync(resolve(home, '.kevin', 'config'), { recursive: true });
  writeFileSync(
    resolve(home, '.claude', 'settings.local.json'),
    JSON.stringify({
      env: {
        PERPLEXITY_API_KEY: 'pplx-secretvalue1234567890',
        KEVIN_DB_MAIN: 'postgres://user:pass@host/db',
        GSC_SITE_URL: 'https://example.com',
        KEVIN_CODE_PATH: '/Users/x/code'
      }
    })
  );
  writeFileSync(resolve(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: [] } }));
  writeFileSync(resolve(home, '.kevin', 'config', 'google-tokens.json'), '{"refresh_token":"x"}');
  return home;
};
const run = (home: string) =>
  spawnSync(process.execPath, [scriptPath], { env: { ...process.env, KEVIN_HOME: home }, encoding: 'utf-8' });
const lastJson = (stdout: string) =>
  JSON.parse(
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? '{}'
  );

describe('0.3.0 migration script (end-to-end on a temp HOME)', () => {
  test('moves secrets, preserves non-secrets, relocates google, writes denies', () => {
    const home = seedHome();
    const proc = run(home);
    expect(proc.status).toBe(0);
    const report = lastJson(proc.stdout);
    expect(report.ok).toBe(true);
    expect(report.moved.sort()).toEqual(['KEVIN_DB_MAIN', 'PERPLEXITY_API_KEY']);
    const secretsEnv = readFileSync(resolve(home, '.kevin', 'secrets', '.env'), 'utf-8');
    expect(secretsEnv).toContain('PERPLEXITY_API_KEY=pplx-secretvalue1234567890');
    expect(secretsEnv).toContain('KEVIN_DB_MAIN=postgres://user:pass@host/db');
    const settings = JSON.parse(readFileSync(resolve(home, '.claude', 'settings.local.json'), 'utf-8'));
    expect(settings.env.PERPLEXITY_API_KEY).toBeUndefined();
    expect(settings.env.GSC_SITE_URL).toBe('https://example.com');
    expect(settings.env.KEVIN_CODE_PATH).toBe('/Users/x/code');
    expect(existsSync(resolve(home, '.kevin', 'secrets', 'google', 'google-tokens.json'))).toBe(true);
    expect(existsSync(resolve(home, '.kevin', 'config', 'google-tokens.json'))).toBe(false);
    const project = JSON.parse(readFileSync(resolve(home, '.claude', 'settings.json'), 'utf-8'));
    // Both deny layers: Read tool (permissions.deny) + Bash cat/grep (sandbox read-deny).
    expect(project.permissions.deny).toContain('Read(**/.kevin/secrets/**)');
    expect(report.sandboxDenyAdded).toBe(true);
    expect(project.sandbox.filesystem.read.denyOnly).toContain('**/.kevin/secrets/**');
  });

  test('purges the upgrade skill pre-strip settings.local.json backup, keeps non-secret ones', () => {
    const home = seedHome();
    // The upgrade skill's Step 3 snapshots settings.local.json (still with secrets)
    // into the non-deny-gated .kevin/updates/ before this script runs.
    const leakyDir = resolve(home, '.kevin', 'updates', '0.2.1-to-0.3.1-stamp', '.claude');
    mkdirSync(leakyDir, { recursive: true });
    const leaky = resolve(leakyDir, 'settings.local.json');
    writeFileSync(leaky, readFileSync(resolve(home, '.claude', 'settings.local.json'), 'utf-8'));
    // A backup with no secret keys (post-migration shape) must survive.
    const cleanDir = resolve(home, '.kevin', 'updates', 'later-run', '.claude');
    mkdirSync(cleanDir, { recursive: true });
    const clean = resolve(cleanDir, 'settings.local.json');
    writeFileSync(clean, JSON.stringify({ env: { KEVIN_CODE_PATH: '/Users/x/code' } }));

    const report = lastJson(run(home).stdout);
    expect(report.ok).toBe(true);
    expect(report.leakedBackupsRemoved).toContain(leaky);
    expect(existsSync(leaky)).toBe(false);
    expect(existsSync(clean)).toBe(true);
  });

  test('is idempotent — re-run moves nothing and stays ok', () => {
    const home = seedHome();
    expect(run(home).status).toBe(0);
    const report = lastJson(run(home).stdout);
    expect(report.ok).toBe(true);
    expect(report.moved).toEqual([]);
    expect(report.denyAdded).toEqual([]);
    expect(report.sandboxDenyAdded).toBe(false);
  });

  test('does not clobber an existing real key in secrets/.env', () => {
    const home = seedHome();
    mkdirSync(resolve(home, '.kevin', 'secrets'), { recursive: true });
    writeFileSync(resolve(home, '.kevin', 'secrets', '.env'), 'PERPLEXITY_API_KEY=pplx-already-real-value-xyz\n');
    const report = lastJson(run(home).stdout);
    expect(report.skipped).toContain('PERPLEXITY_API_KEY');
    expect(readFileSync(resolve(home, '.kevin', 'secrets', '.env'), 'utf-8')).toContain('pplx-already-real-value-xyz');
  });
});
