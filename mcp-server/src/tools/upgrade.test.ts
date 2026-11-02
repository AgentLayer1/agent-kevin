import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOME_MARKER_FILES, RUNTIME_DIR, pluginName } from '@/shared/naming';
import { secretsReadBlocked } from '@/shared/sandbox-probe';
import { installDeps, installRoot, tools } from '@/tools/upgrade';

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

  test('takes a version or install, never both and never neither', async () => {
    expect(await tools[0].handler({ version: '0.7.2', install: true })).toMatchObject({ ok: false });
    expect(await tools[0].handler({})).toMatchObject({ ok: false });
  });

  test('install needs a pluginRoot it accepts', async () => {
    expect(await tools[0].handler({ install: true })).toMatchObject({ ok: false, exitCode: -1 });
    expect(await tools[0].handler({ install: true, pluginRoot: tmpdir() })).toMatchObject({ ok: false, exitCode: -1 });
  });

  describe('installRoot', () => {
    const cache = mkdtempSync(join(tmpdir(), 'run-upgrade-cache-'));
    const plugin = join(cache, 'acme-market', 'acme-agent');
    const versionDir = (version: string, withPackage = true) => {
      const dir = join(plugin, version);
      mkdirSync(join(dir, 'mcp-server'), { recursive: true });
      if (withPackage) writeFileSync(join(dir, 'mcp-server', 'package.json'), '{}');
      return dir;
    };
    const running = versionDir('0.9.1');

    afterAll(() => rmSync(cache, { recursive: true, force: true }));

    test("accepts the server's own root", () => {
      expect(installRoot(running, running)).toBe(realpathSync(running));
    });

    test('accepts the newer version folder an update landed beside it', () => {
      const updated = versionDir('0.9.2');
      expect(installRoot(updated, running)).toBe(realpathSync(updated));
    });

    test('refuses a sibling version folder with no mcp-server package', () => {
      expect(installRoot(versionDir('0.9.3', false), running)).toBeNull();
    });

    test('refuses a version folder of another plugin', () => {
      const other = join(cache, 'acme-market', 'other-agent', '0.9.2');
      mkdirSync(join(other, 'mcp-server'), { recursive: true });
      writeFileSync(join(other, 'mcp-server', 'package.json'), '{}');
      expect(installRoot(other, running)).toBeNull();
    });

    test('refuses a sibling of a checkout that is not a version folder', () => {
      const checkout = join(cache, 'acme-agent');
      const neighbour = join(cache, '1.0.0');
      [checkout, neighbour].forEach((dir) => {
        mkdirSync(join(dir, 'mcp-server'), { recursive: true });
        writeFileSync(join(dir, 'mcp-server', 'package.json'), '{}');
      });
      expect(installRoot(neighbour, checkout)).toBeNull();
    });

    test('refuses a path that does not exist', () => {
      expect(installRoot(join(plugin, '9.9.9'), running)).toBeNull();
    });
  });

  test('install reports a clean bun install as ok', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-upgrade-install-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0' }));
    try {
      expect(await installDeps(dir)).toMatchObject({ ok: true, exitCode: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('install reports a failing bun install with its exit code and stderr', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-upgrade-install-'));
    writeFileSync(join(dir, 'package.json'), '{ not json');
    try {
      const result = await installDeps(dir);
      expect(result.ok).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).not.toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.skipIf(secretsReadBlocked())("hands the operator's choices to the script", async () => {
    const zdot = mkdtempSync(join(tmpdir(), 'run-upgrade-zdot-'));
    const saved = { SHELL: process.env.SHELL, ZDOTDIR: process.env.ZDOTDIR };
    mkdirSync(join(home, RUNTIME_DIR, 'secrets'), { recursive: true });
    writeFileSync(
      join(home, RUNTIME_DIR, 'secrets', '.env.claude.json'),
      JSON.stringify({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'fixture-token', AGENT_SUBSCRIPTION: '1' } })
    );
    Object.assign(process.env, { AGENT_HOME: home, SHELL: '/bin/zsh', ZDOTDIR: zdot });
    try {
      const result = await tools[0].handler({ version: '0.9.0', options: { installLauncher: true } });
      expect(result).toMatchObject({ ok: true, report: { token: 'present', launcher: { appended: true } } });
      expect(readFileSync(join(zdot, '.zshrc'), 'utf-8')).toContain('agent()');
    } finally {
      Object.entries(saved).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
      rmSync(zdot, { recursive: true, force: true });
    }
  });
});
