import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, '0.6.4.ts');

const homes: string[] = [];
const makeHome = (config?: string): string => {
  const home = mkdtempSync(join(tmpdir(), 'migrate-064-'));
  homes.push(home);
  if (config !== undefined) {
    mkdirSync(join(home, '.codex'));
    writeFileSync(join(home, '.codex', 'config.toml'), config);
  }
  return home;
};
const run = (home: string): { status: number | null; report: Record<string, unknown> } => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(KEVIN|AGENT)_/.test(key))) as Record<
    string,
    string
  >;
  const result = spawnSync('bun', [SCRIPT], { env: { ...env, KEVIN_HOME: home }, encoding: 'utf-8' });
  return { status: result.status, report: JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}') };
};
const configOf = (home: string): string => readFileSync(join(home, '.codex', 'config.toml'), 'utf-8');

afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

describe('0.6.4 Codex model default', () => {
  test('switches the old default to Sol, keeping every other line, then is a no-op', () => {
    const home = makeHome(
      'default_permissions = "kevin"\nmodel = "gpt-6-astra" # shipped default\nmodel_reasoning_effort = "high"\n\n[tui]\nanimations = false\n'
    );
    expect(run(home)).toEqual({
      status: 0,
      report: expect.objectContaining({ ok: true, action: 'switched', model: 'gpt-6.1-sol' })
    });
    expect(configOf(home)).toBe(
      'default_permissions = "kevin"\nmodel = "gpt-6.1-sol" # shipped default\nmodel_reasoning_effort = "high"\n\n[tui]\nanimations = false\n'
    );
    expect(run(home).report).toMatchObject({ ok: true, action: 'kept', model: 'gpt-6.1-sol' });
  });

  test('keeps a model the operator chose', () => {
    const config = 'model = "gpt-6"\n\n[profiles.fast]\nmodel = "gpt-6-astra"\n';
    const home = makeHome(config);
    expect(run(home).report).toMatchObject({ ok: true, action: 'kept', model: 'gpt-6' });
    expect(configOf(home)).toBe(config);
  });

  test('fails without writing when the top-level key is in a form it cannot rewrite', () => {
    const config = '"model" = "gpt-6-astra"\n\n[profiles.fast]\nmodel = "gpt-6-astra"\n';
    const home = makeHome(config);
    expect(run(home)).toEqual({ status: 1, report: expect.objectContaining({ ok: false }) });
    expect(configOf(home)).toBe(config);
  });

  test('does nothing for a home not wired to Codex', () => {
    expect(run(makeHome()).report).toMatchObject({ ok: true, action: 'no-codex-config' });
  });
});
