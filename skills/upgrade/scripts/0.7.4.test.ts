import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { RUNTIME_DIR, legacyEnvPrefix, pluginName } from '../../../mcp-server/src/shared/naming';
import { secretsReadBlocked } from '../../../mcp-server/src/shared/sandbox-probe';

const SCRIPT = resolve(import.meta.dir, '0.7.4.ts');
const LEGACY = legacyEnvPrefix();
// A sandbox that guards the secrets store can't read a temp home's either, so those cases skip there.
const SECRETS_READABLE = !secretsReadBlocked();

const SH_SNIPPET = `set -a; d="$${LEGACY}HOME"; [ -z "$d" ] && d="$AGENT_HOME"; [ -z "$d" ] && d="<HOME_DIR>"; f="$d/${RUNTIME_DIR}/secrets/.env"; [ -f "$f" ] && . "$f"; set +a; exec acme-mcp`;
const PS_SNIPPET = `$d = $env:${LEGACY}HOME; if (-not $d) { $d = $env:AGENT_HOME }; if (-not $d) { $d = '<HOME_DIR>' }; $f = Join-Path $d '${RUNTIME_DIR}/secrets/.env'; acme-mcp`;
const SECRETS = [
  '# acme credentials',
  `${LEGACY}DB_MAIN=postgres://fixture-legacy@localhost/main`,
  'AGENT_DB_MAIN=postgres://fixture-shadowed@localhost/main',
  `export ${LEGACY}DB_SIDE = postgres://fixture-side@localhost/side`,
  'GITHUB_TOKEN=fixture-token',
  ''
].join('\n');

const homes: string[] = [];
const write = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf-8');
const readJson = (root: string, rel: string): Record<string, any> => JSON.parse(read(root, rel));

/** A home holding legacy keys in every place the migration covers, plus a user dir with user-level ones. */
const makeHome = (): { home: string; user: string } => {
  const home = mkdtempSync(join(tmpdir(), 'migrate-074-'));
  const user = mkdtempSync(join(tmpdir(), 'migrate-074-user-'));
  homes.push(home, user);
  write(home, `${RUNTIME_DIR}/version.json`, json({ plugin: pluginName() }));
  write(
    home,
    '.claude/settings.json',
    json({
      env: { [`${LEGACY}REPORTS`]: '/shared/reports', AGENT_TIMEZONE: 'Asia/Kuala_Lumpur' },
      permissions: { allow: [`Bash(echo $${LEGACY}HOME)`, 'Read(//**/.kevin/secrets/**)'] }
    })
  );
  write(
    home,
    '.claude/settings.local.json',
    json({
      env: {
        [`${LEGACY}CODE_PATH`]: '/code/legacy',
        AGENT_CODE_PATH: '/code/shadowed',
        AGENT_REPORTS: '/local/reports',
        CLAUDE_CODE_OAUTH_TOKEN: 'fixture-oauth'
      }
    })
  );
  if (SECRETS_READABLE) {
    write(home, `${RUNTIME_DIR}/secrets/.env`, SECRETS);
    spawnSync('chmod', ['600', join(home, RUNTIME_DIR, 'secrets', '.env')]);
  }
  write(
    home,
    '.mcp.json',
    json({
      mcpServers: {
        acme: { command: 'sh', args: ['-c', SH_SNIPPET] },
        'acme-ps': { command: 'pwsh', args: ['-NoProfile', '-Command', PS_SNIPPET] },
        old: {
          command: 'sh',
          args: ['-c', `d="$${LEGACY}HOME"; f="$d/x"`],
          env: { [`${LEGACY}FLAG`]: `\${${LEGACY}FLAG}` }
        },
        plain: { command: 'node', args: ['server.js'] }
      }
    })
  );
  write(user, '.claude/settings.json', json({ env: { [`${LEGACY}HOME`]: '/somewhere', AGENT_TIMEZONE: 'UTC' } }));
  return { home, user };
};

const run = (home: string, user: string): { status: number | null; stdout: string; report: Record<string, any> } => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith(LEGACY) && !key.startsWith('AGENT_'))
  ) as Record<string, string>;
  const result = spawnSync('bun', [SCRIPT], {
    env: { ...env, AGENT_HOME: home, HOME: user, CLAUDE_CONFIG_DIR: join(user, '.claude') },
    encoding: 'utf-8'
  });
  return {
    status: result.status,
    stdout: result.stdout,
    report: JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')
  };
};

afterAll(() => homes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('0.7.4 AGENT_* rename', () => {
  test('renames settings keys and references; a legacy value beats its twin in either file', () => {
    const { home, user } = makeHome();
    const { status, report } = run(home, user);
    expect(status).toBe(0);
    expect(report).toMatchObject({ ok: true, action: 'renamed' });
    expect(readJson(home, '.claude/settings.json')).toEqual({
      env: { AGENT_REPORTS: '/shared/reports', AGENT_TIMEZONE: 'Asia/Kuala_Lumpur' },
      permissions: { allow: ['Bash(echo $AGENT_HOME)', 'Read(//**/.kevin/secrets/**)'] }
    });
    expect(readJson(home, '.claude/settings.local.json').env).toEqual({
      AGENT_CODE_PATH: '/code/legacy',
      CLAUDE_CODE_OAUTH_TOKEN: 'fixture-oauth'
    });
    expect(report.settings).toEqual([
      { file: join('.claude', 'settings.json'), renamed: [`${LEGACY}REPORTS`], replaced: [] },
      {
        file: join('.claude', 'settings.local.json'),
        renamed: [`${LEGACY}CODE_PATH`],
        replaced: ['AGENT_CODE_PATH', 'AGENT_REPORTS']
      }
    ]);
  });

  test.skipIf(!SECRETS_READABLE)(
    'renames secrets line by line, comments out a shadowed twin, keeps mode and backs up inside the store',
    () => {
      const { home, user } = makeHome();
      const { report } = run(home, user);
      expect(read(home, `${RUNTIME_DIR}/secrets/.env`)).toBe(
        [
          '# acme credentials',
          'AGENT_DB_MAIN=postgres://fixture-legacy@localhost/main',
          '# AGENT_DB_MAIN=postgres://fixture-shadowed@localhost/main',
          'export AGENT_DB_SIDE = postgres://fixture-side@localhost/side',
          'GITHUB_TOKEN=fixture-token',
          ''
        ].join('\n')
      );
      expect(statSync(join(home, RUNTIME_DIR, 'secrets', '.env')).mode & 0o777).toBe(0o600);
      const backups = readdirSync(join(home, RUNTIME_DIR, 'secrets')).filter((name) => name.endsWith('.bak'));
      expect(backups).toHaveLength(1);
      expect(read(home, `${RUNTIME_DIR}/secrets/${backups[0]}`)).toBe(SECRETS);
      expect(statSync(join(home, RUNTIME_DIR, 'secrets', backups[0])).mode & 0o777).toBe(0o600);
      expect(report.secrets).toEqual({
        renamed: [`${LEGACY}DB_MAIN`, `${LEGACY}DB_SIDE`],
        replaced: ['AGENT_DB_MAIN']
      });
    }
  );

  test('collapses the server home fallback in both shells and renames server env keys', () => {
    const { home, user } = makeHome();
    const { report } = run(home, user);
    const servers = readJson(home, '.mcp.json').mcpServers;
    expect(servers.acme.args[1]).toStartWith('set -a; d="$AGENT_HOME"; [ -z "$d" ] && d="<HOME_DIR>"; f=');
    expect(servers['acme-ps'].args[2]).toStartWith("$d = $env:AGENT_HOME; if (-not $d) { $d = '<HOME_DIR>' }; $f =");
    expect(servers.old).toEqual({
      command: 'sh',
      args: ['-c', 'd="$AGENT_HOME"; f="$d/x"'],
      env: { AGENT_FLAG: '${AGENT_FLAG}' }
    });
    expect(servers.plain).toEqual({ command: 'node', args: ['server.js'] });
    expect(report.mcp).toEqual({ file: '.mcp.json', servers: ['acme', 'acme-ps', 'old'] });
    expect(read(home, '.mcp.json')).not.toContain(LEGACY);
  });

  test('lists user-level keys for the operator and never edits that file', () => {
    const { home, user } = makeHome();
    const userSettings = read(user, '.claude/settings.json');
    const { report } = run(home, user);
    expect(report.manual).toEqual([{ file: join(user, '.claude', 'settings.json'), keys: [`${LEGACY}HOME`] }]);
    expect(read(user, '.claude/settings.json')).toBe(userSettings);
  });

  test('a file that does not parse stops the run before anything is written', () => {
    const { home, user } = makeHome();
    write(home, '.claude/settings.local.json', '{ "env": { // not JSON\n');
    const shared = read(home, '.claude/settings.json');
    const mcp = read(home, '.mcp.json');
    const { status, report } = run(home, user);
    expect(status).toBe(1);
    expect(report.ok).toBe(false);
    expect(read(home, '.claude/settings.json')).toBe(shared);
    expect(read(home, '.mcp.json')).toBe(mcp);
    expect(existsSync(join(home, RUNTIME_DIR, 'updates'))).toBe(false);
  });

  test('writes through a symlinked settings file, keeping the link', () => {
    const { home, user } = makeHome();
    const real = join(user, 'dotfiles-settings.local.json');
    write(user, 'dotfiles-settings.local.json', read(home, '.claude/settings.local.json'));
    rmSync(join(home, '.claude', 'settings.local.json'));
    symlinkSync(real, join(home, '.claude', 'settings.local.json'));
    run(home, user);
    expect(lstatSync(join(home, '.claude', 'settings.local.json')).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, 'utf-8')).env.AGENT_CODE_PATH).toBe('/code/legacy');
  });

  test('reports names only, backs up config first, and a re-run is a no-op', () => {
    const { home, user } = makeHome();
    const before = { settings: read(home, '.claude/settings.local.json'), mcp: read(home, '.mcp.json') };
    const first = run(home, user);
    expect(first.stdout).not.toContain('fixture');
    expect(first.stdout).not.toContain('/code/');
    const [updates] = readdirSync(join(home, RUNTIME_DIR, 'updates'));
    expect(read(home, `${RUNTIME_DIR}/updates/${updates}/settings.local.json`)).toBe(before.settings);
    expect(read(home, `${RUNTIME_DIR}/updates/${updates}/.mcp.json`)).toBe(before.mcp);
    const files = [
      '.claude/settings.json',
      '.claude/settings.local.json',
      '.mcp.json',
      ...(SECRETS_READABLE ? [`${RUNTIME_DIR}/secrets/.env`] : [])
    ];
    const after = files.map((rel) => read(home, rel));
    const second = run(home, user);
    expect(second.report).toMatchObject({ ok: true, action: 'none', settings: [], secrets: null, mcp: null });
    expect(files.map((rel) => read(home, rel))).toEqual(after);
  });

  test('a folder that is not this agent home is left alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-074-bare-'));
    homes.push(dir);
    write(dir, '.claude/settings.json', json({ env: { [`${LEGACY}HOME`]: '/x' } }));
    expect(run(dir, dir).report).toMatchObject({ ok: true, action: 'no-data-dir' });
    expect(readJson(dir, '.claude/settings.json').env).toEqual({ [`${LEGACY}HOME`]: '/x' });
    expect(existsSync(join(dir, RUNTIME_DIR))).toBe(false);
  });
});
