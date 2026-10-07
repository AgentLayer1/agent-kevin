import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { secretsReadBlocked } from '../../../mcp-server/src/shared/sandbox-probe';

const SCRIPT = resolve(import.meta.dir, '0.7.0.ts');
const PLUGIN = 'agent-kevin';

const homes: string[] = [];
const write = (home: string, path: string, text: string): void => {
  mkdirSync(dirname(join(home, path)), { recursive: true });
  writeFileSync(join(home, path), text);
};
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const read = (home: string, path: string): unknown => JSON.parse(readFileSync(join(home, path), 'utf-8'));

const SETTINGS = {
  permissions: { deny: ['Read(//**/.kevin/secrets/**)', 'Read(~/.ssh/id_*)'] },
  sandbox: {
    enabled: true,
    filesystem: { denyRead: ['.kevin/secrets'], allowWrite: ['~/.cache/uv'] },
    credentials: { files: [{ path: '.kevin/secrets', mode: 'deny' }] }
  }
};
const MCP = {
  mcpServers: {
    acme: { command: 'sh', args: ['-c', 'set -a; d="$KEVIN_HOME"; f="$d/.kevin/secrets/.env"; [ -f "$f" ] && . "$f"'] },
    other: { command: 'bun', args: ['serve.ts'] }
  }
};

/**
 * A home as 0.6.x leaves it: the agent-named data dir, settings and a pack server. `versionJson: null`
 * leaves only the compile cursor. Secrets are opt-in: a sandbox that denies the legacy store also
 * refuses to delete one the migration didn't move.
 */
const legacyHome = ({
  versionJson = json({ templateVersion: '0.6.5', history: [] }),
  secrets = false
}: { versionJson?: string | null; secrets?: boolean } = {}): string => {
  const home = mkdtempSync(join(tmpdir(), 'migrate-070-'));
  homes.push(home);
  write(home, 'SOUL.md', '# Soul\n');
  write(home, '.kevin/knowledge.json', '{}\n');
  write(home, '.kevin/template-base/AGENTS.md', '# manual\n');
  if (secrets) {
    write(home, '.kevin/secrets/.env', 'ACME_TOKEN=fixture-not-a-secret\n');
  }
  if (versionJson !== null) {
    write(home, '.kevin/version.json', versionJson);
  }
  write(home, '.claude/settings.json', json(SETTINGS));
  write(home, '.mcp.json', json(MCP));
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

afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

describe('0.7.0 data dir move', () => {
  test('moves the legacy dir to .state, recording this plugin first and keeping every file', () => {
    const home = legacyHome();
    expect(run(home)).toEqual({
      status: 0,
      report: expect.objectContaining({ ok: true, action: 'moved', stamp: 'stamped', repointed: ['.mcp.json'] })
    });
    expect(existsSync(join(home, '.kevin'))).toBe(false);
    expect(read(home, '.state/version.json')).toEqual({ plugin: PLUGIN, templateVersion: '0.6.5', history: [] });
    expect(Object.keys(read(home, '.state/version.json') as object)[0]).toBe('plugin');
    expect(existsSync(join(home, '.state/knowledge.json'))).toBe(true);
    expect(existsSync(join(home, '.state/template-base/AGENTS.md'))).toBe(true);
  });

  // A sandbox that carries the .state/secrets guard can't read the moved store back.
  test.skipIf(secretsReadBlocked())('carries the secrets store across the move intact', () => {
    const home = legacyHome({ secrets: true });
    run(home);
    expect(readFileSync(join(home, '.state/secrets/.env'), 'utf-8')).toBe('ACME_TOKEN=fixture-not-a-secret\n');
  });

  // A home whose legacy store was protected only by user-level settings has nothing to copy from.
  test('adds the .state secrets rules even when the home settings carried none', () => {
    const home = legacyHome();
    write(home, '.claude/settings.json', json({ permissions: { allow: ['Read'] } }));
    run(home);
    expect(read(home, '.claude/settings.json')).toEqual({
      permissions: { allow: ['Read'], deny: ['Read(//**/.state/secrets/**)'] },
      sandbox: {
        filesystem: { denyRead: ['.state/secrets'] },
        credentials: { files: [{ path: '.state/secrets', mode: 'deny' }] }
      }
    });
  });

  test('keeps the moved store out of history by reconciling .gitignore before the move', () => {
    const home = legacyHome();
    write(home, '.gitignore', '.kevin/*\n!.kevin/knowledge.json\n!.kevin/version.json\n');
    expect(run(home).report).toMatchObject({ ok: true, gitignore: expect.arrayContaining(['.state/*']) });
    expect(readFileSync(join(home, '.gitignore'), 'utf-8')).toContain('\n.state/*\n!.state/knowledge.json\n');
  });

  test('repoints the PowerShell launch form too', () => {
    const home = legacyHome();
    const powershell = "$f = Join-Path $d '.kevin/secrets/.env'";
    write(home, '.mcp.json', json({ mcpServers: { pwsh: { command: 'pwsh', args: ['-Command', powershell] } } }));
    run(home);
    expect((read(home, '.mcp.json') as { mcpServers: { pwsh: { args: string[] } } }).mcpServers.pwsh.args[1]).toBe(
      "$f = Join-Path $d '.state/secrets/.env'"
    );
  });

  test('adds a .state twin beside each legacy secrets rule and removes nothing', () => {
    const home = legacyHome();
    run(home);
    expect(read(home, '.claude/settings.json')).toEqual({
      permissions: { deny: ['Read(//**/.kevin/secrets/**)', 'Read(~/.ssh/id_*)', 'Read(//**/.state/secrets/**)'] },
      sandbox: {
        enabled: true,
        filesystem: { denyRead: ['.kevin/secrets', '.state/secrets'], allowWrite: ['~/.cache/uv'] },
        credentials: {
          files: [
            { path: '.kevin/secrets', mode: 'deny' },
            { path: '.state/secrets', mode: 'deny' }
          ]
        }
      }
    });
  });

  test('repoints only the .mcp.json servers that read the legacy secrets file', () => {
    const home = legacyHome();
    run(home);
    const servers = (read(home, '.mcp.json') as typeof MCP).mcpServers;
    expect(servers.acme.args[1]).toContain('$d/.state/secrets/.env');
    expect(servers.acme.args[1]).not.toContain('.kevin');
    expect(servers.other).toEqual(MCP.mcpServers.other);
  });

  test('repoints what the operator put in settings.local.json, and only legacy-folder paths', () => {
    const home = legacyHome();
    const local = {
      env: { ACME_CREDENTIALS: '/home/user/.kevin/secrets/google/client.json', ACME_CACHE: '/srv/acme.kevin/cache' },
      permissions: { allow: ['Read(.kevin/logs/**)'] }
    };
    write(home, '.claude/settings.local.json', json(local));
    expect(run(home).report.repointed).toEqual(['.mcp.json', '.claude/settings.local.json']);
    expect(read(home, '.claude/settings.local.json')).toEqual({
      env: { ACME_CREDENTIALS: '/home/user/.state/secrets/google/client.json', ACME_CACHE: '/srv/acme.kevin/cache' },
      permissions: { allow: ['Read(.state/logs/**)'] }
    });
  });

  test('backs up every file it rewrites before rewriting it', () => {
    const home = legacyHome();
    run(home);
    const [backup] = readdirSync(join(home, '.state/updates')).filter((name) => name.startsWith('0.7.0-'));
    expect(backup).toBeDefined();
    const saved = readdirSync(join(home, '.state/updates', String(backup))).sort();
    expect(saved).toEqual(['.mcp.json', 'settings.json', 'version.json']);
    expect(read(home, `.state/updates/${backup}/settings.json`)).toEqual(SETTINGS);
  });

  test('a re-run is a no-op that reports the move as done', () => {
    const home = legacyHome();
    run(home);
    const settings = readFileSync(join(home, '.claude/settings.json'), 'utf-8');
    const mcp = readFileSync(join(home, '.mcp.json'), 'utf-8');
    expect(run(home).report).toMatchObject({
      ok: true,
      action: 'already-moved',
      stamp: 'current',
      denies: [],
      gitignore: [],
      repointed: []
    });
    expect(readFileSync(join(home, '.claude/settings.json'), 'utf-8')).toBe(settings);
    expect(readFileSync(join(home, '.mcp.json'), 'utf-8')).toBe(mcp);
  });

  test('a legacy dir with only the compile cursor gets a version.json recording this plugin', () => {
    const home = legacyHome({ versionJson: null });
    expect(run(home).report).toMatchObject({ ok: true, action: 'moved', stamp: 'created' });
    expect(read(home, '.state/version.json')).toEqual({ plugin: PLUGIN });
  });

  test('refuses to move onto a .state it does not own, touching nothing', () => {
    const home = legacyHome();
    write(home, '.state/version.json', json({ plugin: 'agent-other' }));
    const settings = readFileSync(join(home, '.claude/settings.json'), 'utf-8');
    const { status, report } = run(home);
    expect(status).toBe(1);
    expect(report).toMatchObject({ ok: false });
    expect(String(report.error)).toContain("is not this agent's to move onto");
    expect(existsSync(join(home, '.kevin/knowledge.json'))).toBe(true);
    expect(readFileSync(join(home, '.claude/settings.json'), 'utf-8')).toBe(settings);
  });

  test('refuses a legacy dir recorded for another plugin', () => {
    const home = legacyHome({ versionJson: json({ plugin: 'agent-other' }) });
    const { status, report } = run(home);
    expect(status).toBe(1);
    expect(String(report.error)).toContain('records another plugin');
    expect(existsSync(join(home, '.kevin'))).toBe(true);
  });

  test('refuses an unreadable baseline before moving anything', () => {
    const home = legacyHome({ versionJson: 'not json' });
    const { status, report } = run(home);
    expect(status).toBe(1);
    expect(String(report.error)).toContain('does not parse');
    expect(existsSync(join(home, '.kevin'))).toBe(true);
    expect(existsSync(join(home, '.state'))).toBe(false);
  });

  test('a home with no data dir reports it and changes nothing', () => {
    const home = mkdtempSync(join(tmpdir(), 'migrate-070-'));
    homes.push(home);
    expect(run(home).report).toMatchObject({ ok: true, action: 'no-data-dir' });
    expect(existsSync(join(home, '.state'))).toBe(false);
  });
});
