import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';
import { tools } from '@/tools/upgrade';

const runUpgrade = (version: string) => tools[0].handler({ version }) as Promise<Record<string, unknown>>;

const home = mkdtempSync(join(tmpdir(), 'run-upgrade-'));
const PRELOAD_HOME = process.env.AGENT_HOME;

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  if (PRELOAD_HOME === undefined) delete process.env.AGENT_HOME;
  else process.env.AGENT_HOME = PRELOAD_HOME;
});

describe('run_upgrade', () => {
  test('refuses anything but MAJOR.MINOR.PATCH, so a version cannot name a path', async () => {
    expect(await runUpgrade('../../etc/passwd')).toMatchObject({ ok: false, found: false });
  });

  test('a pruned or never-shipped script is reported as already applied, not as an error', async () => {
    expect(await runUpgrade('0.3.0')).toMatchObject({ ok: true, found: false });
  });

  test('runs a migration against this home and returns its report', async () => {
    mkdirSync(join(home, RUNTIME_DIR), { recursive: true });
    writeFileSync(join(home, RUNTIME_DIR, HOME_MARKER_FILES[0]), `${JSON.stringify({ plugin: pluginName() })}\n`);
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { ask: ['mcp__xcode__RunCodeSnippet'] } })
    );
    process.env.AGENT_HOME = home;
    expect(await runUpgrade('0.7.2')).toMatchObject({
      ok: true,
      found: true,
      report: { ok: true, askDropped: ['mcp__xcode__RunCodeSnippet'] }
    });
    expect(JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf-8')).permissions.ask).toEqual([]);
  });
});
