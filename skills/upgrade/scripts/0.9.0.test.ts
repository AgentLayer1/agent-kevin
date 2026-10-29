import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { RUNTIME_DIR, pluginName } from '../../../mcp-server/src/shared/naming';
import { secretsReadBlocked } from '../../../mcp-server/src/shared/sandbox-probe';

const SCRIPT = resolve(import.meta.dir, '0.9.0.ts');
const LAUNCHER = readFileSync(resolve(import.meta.dir, '..', '..', '..', 'templates', 'shell', 'agent.sh'), 'utf-8');
const SUBSCRIPTION = `${RUNTIME_DIR}/secrets/.env.claude.json`;
const TOKEN = 'fixture-subscription-token';
// A sandbox that guards the secrets store can't read a temp home's either, so those cases skip there.
const SECRETS_READABLE = !secretsReadBlocked();

const dirs: string[] = [];
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
const write = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const read = (root: string, rel: string): string => readFileSync(join(root, rel), 'utf-8');
const readJson = (root: string, rel: string): Record<string, unknown> => JSON.parse(read(root, rel));

interface Fixture {
  home: string;
  user: string;
}

const makeHome = (local: Record<string, unknown> | null): Fixture => {
  const home = tempDir('migrate-090-');
  const user = tempDir('migrate-090-user-');
  write(home, `${RUNTIME_DIR}/version.json`, json({ plugin: pluginName() }));
  if (local) {
    write(home, '.claude/settings.local.json', json(local));
  }
  return { home, user };
};

const LOCAL = {
  permissions: { allow: ['Bash(ls)'] },
  env: { AGENT_HOME_TIMEZONE: 'UTC', CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
  statusLine: { type: 'command', command: 'status' }
};

interface Report {
  ok: boolean;
  token?: string;
  subscriptionWritten?: boolean;
  launcher?: Record<string, unknown> | null;
  manual?: string[];
}

interface Run {
  status: number | null;
  stdout: string;
  report: Report;
}

const run = (fixture: Fixture, extra: Record<string, string> = {}): Run => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_') && key !== 'ZDOTDIR')
  ) as Record<string, string>;
  const result = spawnSync('bun', [SCRIPT], {
    env: { ...env, AGENT_HOME: fixture.home, HOME: fixture.user, SHELL: '/bin/zsh', ...extra },
    encoding: 'utf-8'
  });
  return {
    status: result.status,
    stdout: result.stdout,
    report: JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')
  };
};

const install = { AGENT_UPGRADE_OPTIONS: JSON.stringify({ installLauncher: true }) };

afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('0.9.0 subscription move', () => {
  test('the launcher template reads the same file the migration writes', () => {
    expect(LAUNCHER).toContain(`$PWD/${SUBSCRIPTION}`);
  });

  test('a home with no subscription token is left alone and gets no launcher step', () => {
    const fixture = makeHome({ env: { AGENT_HOME_TIMEZONE: 'UTC' } });
    const before = read(fixture.home, '.claude/settings.local.json');
    const { status, report } = run(fixture);
    expect(status).toBe(0);
    expect(report).toMatchObject({ ok: true, token: 'none', launcher: null, manual: [] });
    expect(read(fixture.home, '.claude/settings.local.json')).toBe(before);
  });

  test('settings that are not JSON fail the run before anything changes', () => {
    const fixture = makeHome(null);
    write(fixture.home, '.claude/settings.local.json', '{ "env": ');
    const { status, report } = run(fixture);
    expect(status).toBe(1);
    expect(report.ok).toBe(false);
  });

  test.skipIf(!SECRETS_READABLE)('moves the token into the secrets store with the marker, at 0600', () => {
    const fixture = makeHome(LOCAL);
    const { report, stdout } = run(fixture);
    expect(report).toMatchObject({ ok: true, token: 'moved', subscriptionWritten: true });
    expect(stdout).not.toContain(TOKEN);
    expect(readJson(fixture.home, SUBSCRIPTION)).toEqual({
      env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN, AGENT_SUBSCRIPTION: '1' }
    });
    expect(statSync(join(fixture.home, SUBSCRIPTION)).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(join(fixture.home, SUBSCRIPTION))).mode & 0o777).toBe(0o700);
    const local = readJson(fixture.home, '.claude/settings.local.json');
    expect(Object.keys(local)).toEqual(['permissions', 'env', 'statusLine']);
    expect(local.env).toEqual({ AGENT_HOME_TIMEZONE: 'UTC' });
  });

  test.skipIf(!SECRETS_READABLE)('drops an env block the token leaves empty, and a rerun changes nothing', () => {
    const fixture = makeHome({ env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN }, permissions: {} });
    run(fixture);
    expect(readJson(fixture.home, '.claude/settings.local.json')).toEqual({ permissions: {} });
    const settled = read(fixture.home, SUBSCRIPTION);
    const { report } = run(fixture);
    expect(report).toMatchObject({ token: 'present', subscriptionWritten: false });
    expect(read(fixture.home, SUBSCRIPTION)).toBe(settled);
  });

  test.skipIf(!SECRETS_READABLE)('a different token already in the store is never overwritten', () => {
    const fixture = makeHome(LOCAL);
    write(fixture.home, SUBSCRIPTION, json({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'fixture-other-token' } }));
    const { report } = run(fixture);
    expect(report).toMatchObject({ token: 'conflict', launcher: null });
    expect(report.manual).toHaveLength(1);
    expect(readJson(fixture.home, SUBSCRIPTION)).toEqual({
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'fixture-other-token' }
    });
    expect(readJson(fixture.home, '.claude/settings.local.json')).toEqual(LOCAL);
  });

  test.skipIf(!SECRETS_READABLE)('a hand-made subscription file gets the marker and keeps its token', () => {
    const fixture = makeHome({ env: { AGENT_HOME_TIMEZONE: 'UTC' } });
    write(fixture.home, SUBSCRIPTION, json({ env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN } }));
    const { report } = run(fixture);
    expect(report).toMatchObject({ token: 'present', subscriptionWritten: true });
    expect(readJson(fixture.home, SUBSCRIPTION)).toEqual({
      env: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN, AGENT_SUBSCRIPTION: '1' }
    });
  });
});

describe.skipIf(!SECRETS_READABLE)('0.9.0 agent launcher', () => {
  test('reports the zsh profile and the command without touching it', () => {
    const fixture = makeHome(LOCAL);
    write(fixture.user, '.zshrc', 'export EDITOR=vim\n');
    const { report } = run(fixture);
    expect(report.launcher).toMatchObject({
      shell: 'zsh',
      profile: join(fixture.user, '.zshrc'),
      installed: false,
      conflict: null,
      appended: false,
      reload: 'source ~/.zshrc'
    });
    expect(String(report.launcher?.command)).toContain('agent.sh');
    expect(read(fixture.user, '.zshrc')).toBe('export EDITOR=vim\n');
  });

  test('appends the launcher once when asked, after a blank line', () => {
    const fixture = makeHome(LOCAL);
    write(fixture.user, '.zshrc', 'export EDITOR=vim\n');
    chmodSync(join(fixture.user, '.zshrc'), 0o600);
    expect(run(fixture, install).report.launcher).toMatchObject({ installed: true, appended: true });
    expect(read(fixture.user, '.zshrc')).toBe(`export EDITOR=vim\n\n${LAUNCHER}`);
    expect(statSync(join(fixture.user, '.zshrc')).mode & 0o777).toBe(0o600);
    expect(run(fixture, install).report.launcher).toMatchObject({ installed: true, appended: false });
    expect(read(fixture.user, '.zshrc')).toBe(`export EDITOR=vim\n\n${LAUNCHER}`);
  });

  test('honours ZDOTDIR and creates a missing profile', () => {
    const fixture = makeHome(LOCAL);
    const zdot = tempDir('migrate-090-zdot-');
    run(fixture, { ...install, ZDOTDIR: zdot });
    expect(read(zdot, '.zshrc')).toBe(LAUNCHER);
    expect(existsSync(join(fixture.user, '.zshrc'))).toBe(false);
  });

  test('a profile that already defines agent is left alone', () => {
    const fixture = makeHome(LOCAL);
    write(fixture.user, '.zshrc', 'agent() {\n  claude "$@"\n}\n');
    const { report } = run(fixture, install);
    expect(report.launcher).toMatchObject({ installed: true, appended: false });
    expect(read(fixture.user, '.zshrc')).toBe('agent() {\n  claude "$@"\n}\n');
  });

  test('bash gets ~/.bashrc, and an unknown shell gets a manual note', () => {
    const bash = makeHome(LOCAL);
    run(bash, { ...install, SHELL: '/bin/bash' });
    expect(read(bash.user, '.bashrc')).toBe(LAUNCHER);
    const fish = makeHome(LOCAL);
    const { report } = run(fish, { ...install, SHELL: '/usr/local/bin/fish' });
    expect(report.launcher).toMatchObject({ shell: null, profile: null, command: null, appended: false });
    expect(report.manual).toHaveLength(1);
  });

  test('an agent program already on PATH blocks the install', () => {
    const fixture = makeHome(LOCAL);
    const bin = tempDir('migrate-090-bin-');
    write(bin, 'agent', '#!/bin/sh\n');
    chmodSync(join(bin, 'agent'), 0o755);
    const { report } = run(fixture, { ...install, PATH: `${bin}:${process.env.PATH ?? ''}` });
    expect(report.launcher).toMatchObject({ conflict: join(bin, 'agent'), appended: false });
    expect(existsSync(join(fixture.user, '.zshrc'))).toBe(false);
    expect(report.manual).toHaveLength(1);
  });
});
