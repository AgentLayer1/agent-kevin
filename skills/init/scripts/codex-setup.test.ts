import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(import.meta.dir, 'codex-setup.ts');
const CLI = resolve(import.meta.dir, '..', '..', '..', 'bin', 'kevin');
const HOME = resolve('/Users/ada/Agents/Scout');
const PLUGIN = resolve('/opt/kevin');
const command = (rest: string, home = HOME, plugin = PLUGIN): string =>
  `bun "${resolve(plugin, 'bin', 'kevin')}" ${rest} --home="${home}"`;
const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-setup-'));
  dirs.push(dir);
  return dir;
};
const NO_USER = resolve(tmpdir(), 'codex-setup-no-user-file');
const run = (...extra: string[]) => {
  const userFlags = extra.includes('--claude-user-settings')
    ? []
    : ['--claude-user-settings', NO_USER, '--codex-user-config', NO_USER];
  const proc = spawnSync(process.execPath, [SCRIPT, ...extra, ...userFlags], { encoding: 'utf-8' });
  return { code: proc.status, json: proc.stdout.trim() ? JSON.parse(proc.stdout) : null, stderr: proc.stderr };
};
const seed = (home: string, file: string, content: unknown): string => {
  const path = join(home, '.codex', file);
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  return path;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('codex-setup hooks', () => {
  test('prints the SessionStart context entry with the cap lifted plus the SessionEnd capture, pinned to the home and plugin', () => {
    const { code, json } = run('--home', HOME, '--plugin-root', PLUGIN);
    expect(code).toBe(0);
    const starts = json.hooks.SessionStart;
    expect(starts).toHaveLength(1);
    expect(starts[0].hooks[0]).toEqual({
      type: 'command',
      command: command('session-start --hook-protocol=codex'),
      timeout: 15,
      additionalContextLimit: 0
    });
    expect(json.hooks.SessionEnd[0].hooks[0].command).toBe(
      command('session-capture --mode=session-end --hook-protocol=codex')
    );
    expect(json.hooks.SessionEnd[0].hooks[0].timeout).toBe(3);
    expect(json.hooks.PreCompact[0].hooks[0].command).toBe(
      command('session-capture --mode=pre-compact --hook-protocol=codex')
    );
    expect(json.hooks.PreToolUse[0].matcher).toBe('Bash');
    expect(json.hooks.PreToolUse[0].hooks[0]).toEqual({
      type: 'command',
      command: command('guard --hook-protocol=codex'),
      timeout: 5
    });
  });

  test('defaults the plugin root to the checkout this script lives in', () => {
    const { json } = run('--home', HOME);
    expect(json.hooks.SessionEnd[0].hooks[0].command).toContain(`"${CLI}"`);
  });

  test('double-quotes paths with spaces and apostrophes, the one quoting sh and PowerShell share', () => {
    const home = resolve("/Users/ada/Agent's Homes/Scout");
    const plugin = resolve('/opt/my kevin');
    const { json } = run('--home', home, '--plugin-root', plugin);
    expect(json.hooks.SessionEnd[0].hooks[0].command).toBe(
      command('session-capture --mode=session-end --hook-protocol=codex', home, plugin)
    );
  });

  test('refuses a path either shell would expand inside double quotes, and writes nothing', () => {
    const home = join(scratch(), 'Ag"ent');
    const { code, stderr } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    expect(code).not.toBe(0);
    expect(stderr).toContain('may not contain');
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  test('the CLI resolves the home from the --home= argument the hook commands carry', () => {
    const home = scratch();
    const proc = spawnSync(process.execPath, [CLI, 'ping', `--home=${home}`], { encoding: 'utf-8' });
    expect(proc.status).toBe(0);
    expect(JSON.parse(proc.stdout).home).toBe(home);
  });

  test("keeps the operator's other hooks, events, and top-level fields", () => {
    const home = scratch();
    seed(home, 'hooks.json', {
      note: 'mine',
      hooks: {
        Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo keep-me' }] }],
        SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'echo also-mine', timeout: 5 }] }]
      }
    });
    const { json } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    expect(json.hooks.changed).toBe(true);
    const written = JSON.parse(readFileSync(json.hooks.path, 'utf-8'));
    expect(written.note).toBe('mine');
    expect(written.hooks.Stop[0].hooks[0].command).toBe('echo keep-me');
    expect(written.hooks.SessionStart).toHaveLength(2);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe('echo also-mine');
    expect(written.hooks.SessionEnd).toHaveLength(1);
  });

  test('replaces its own entries from an older checkout, quoted or not, and is idempotent', () => {
    const home = scratch();
    seed(home, 'hooks.json', {
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: 'AGENT_HOME=/x bun /old/kevin/bin/kevin session-start --hook-protocol=codex --slice=1/12',
                timeout: 15
              }
            ]
          },
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: "AGENT_HOME='/x' bun '/old/kevin/bin/kevin' session-start --hook-protocol=codex --slice=2/12",
                timeout: 15
              }
            ]
          }
        ],
        SessionEnd: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command:
                  'AGENT_HOME=/x bun /old/kevin/bin/kevin session-capture --mode=session-end --hook-protocol=codex --detach',
                timeout: 3
              }
            ]
          }
        ]
      }
    });
    const first = run('--home', home, '--plugin-root', PLUGIN, '--write');
    const written = readFileSync(first.json.hooks.path, 'utf-8');
    expect(written).not.toContain('/old/kevin');
    expect(JSON.parse(written).hooks.SessionStart).toHaveLength(1);
    expect(JSON.parse(written).hooks.SessionEnd).toHaveLength(1);
    const again = run('--home', home, '--plugin-root', PLUGIN, '--write').json;
    expect(again.hooks.changed).toBe(false);
    expect(again.mcp.changed).toBe(false);
  });

  test('refuses to touch a hooks file it cannot parse', () => {
    const home = scratch();
    const path = seed(home, 'hooks.json', '{ not json');
    const { code, stderr } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    expect(code).not.toBe(0);
    expect(stderr).toContain('JSON');
    expect(readFileSync(path, 'utf-8')).toBe('{ not json');
    expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(false);
  });
});

describe('codex-setup mcp registration', () => {
  test('writes the kevin server, the permission profile, the shell env, and the policy keys for a bare home', () => {
    const home = scratch();
    const { json } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    expect(json.mcp).toEqual({ path: join(home, '.codex', 'config.toml'), changed: true });
    expect(json.entries).toBe(4);
    const config = Bun.TOML.parse(readFileSync(json.mcp.path, 'utf-8')) as Record<string, any>;
    expect(config.default_permissions).toBe('kevin');
    expect(config.approval_policy).toBe('on-request');
    expect(config.approvals_reviewer).toBe('user');
    expect(config.mcp_servers.kevin).toEqual({
      command: 'bun',
      args: [resolve(PLUGIN, 'mcp-server', 'src', 'server.ts')],
      env: { AGENT_HOME: home, KEVIN_HOME: home, PLAYWRIGHT_BROWSERS_PATH: '0' }
    });
    expect(config.permissions.kevin.extends).toBe(':workspace');
    expect(config.permissions.kevin.filesystem[join(home, '.kevin', 'secrets')]).toBe('deny');
    expect(config.permissions.kevin.filesystem[':workspace_roots']).toEqual({
      '.git': 'write',
      '**/.kevin/secrets/**': 'deny',
      '**/*.env': 'deny',
      '**/.env.*': 'deny'
    });
    expect(config.permissions.kevin.workspace_roots).toBeUndefined();
    expect(config.permissions.kevin.network).toEqual({ enabled: true });
    expect(config.shell_environment_policy.set).toEqual({ AGENT_HOME: home, KEVIN_HOME: home });
    expect(json.profile).toEqual({ name: 'kevin', workspaceRoots: [], rules: [] });
    expect(readFileSync(json.rules.path, 'utf-8')).not.toContain('prefix_rule');
  });

  test("derives workspace roots, rules, and shell env from the home's Claude settings, never a credential", () => {
    const home = scratch();
    const code = join(scratch(), 'acme');
    const extra = join(scratch(), 'shared');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: {
          deny: ['Read(//**/.kevin/secrets/**)', 'Read(~/.ssh/**)', 'Read(vault/**)', 'WebFetch(domain:example.com)'],
          ask: [
            'Bash(git push)',
            'Bash(git push *)',
            'Bash(gh pr create:*)',
            'mcp__plugin_agent-kevin_kevin__curl_run',
            'Bash(rm -rf *)'
          ],
          additionalDirectories: [extra, join(home, 'projects')]
        }
      })
    );
    writeFileSync(
      join(home, '.claude', 'settings.local.json'),
      JSON.stringify({
        env: {
          AGENT_CODE_PATH: code,
          AGENT_HOME_TIMEZONE: 'Asia/Kuala_Lumpur',
          CLAUDE_CODE_OAUTH_TOKEN: 'sk-nope',
          KEVIN_DB_KEY: 'nope'
        }
      })
    );
    const { json } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    const config = Bun.TOML.parse(readFileSync(json.mcp.path, 'utf-8')) as Record<string, any>;
    expect(config.permissions.kevin.workspace_roots).toEqual({ [code]: true, [extra]: true });
    expect(config.permissions.kevin.filesystem['/**/.kevin/secrets/**']).toBe('deny');
    expect(config.permissions.kevin.filesystem[join(homedir(), '.ssh', '**')]).toBe('deny');
    expect(config.permissions.kevin.filesystem[':workspace_roots']['vault/**']).toBe('deny');
    expect(JSON.stringify(config)).not.toContain('example.com');
    expect(config.shell_environment_policy.set).toEqual({
      AGENT_CODE_PATH: code,
      AGENT_HOME_TIMEZONE: 'Asia/Kuala_Lumpur',
      AGENT_HOME: home,
      KEVIN_HOME: home
    });
    expect(json.profile.rules).toEqual(['git push', 'gh pr create', 'rm -rf']);
    const rules = readFileSync(json.rules.path, 'utf-8');
    expect(rules).toContain('pattern = ["git", "push"],');
    expect(rules).toContain('pattern = ["gh", "pr", "create"],');
    expect(rules).toContain('decision = "prompt"');
    expect(rules).not.toContain('curl_run');
  });

  test("carries Claude's user-level Read denies into the home's profile, except those the user-level Codex profile already denies", () => {
    const home = scratch();
    const dir = scratch();
    const claudeUser = join(dir, 'settings.json');
    writeFileSync(
      claudeUser,
      JSON.stringify({
        permissions: {
          deny: ['Read(~/.ssh/id_*)', 'Read(~/.aws/**)', 'Read(**/*.pem)', 'Bash(sudo *)', 'Edit(~/.zshrc)']
        }
      })
    );
    const codexUser = join(dir, 'config.toml');
    writeFileSync(codexUser, 'default_permissions = "mine"\n\n[permissions.mine.filesystem]\n"~/.aws/**" = "deny"\n');
    const { json } = run(
      '--home',
      home,
      '--plugin-root',
      PLUGIN,
      '--write',
      '--claude-user-settings',
      claudeUser,
      '--codex-user-config',
      codexUser
    );
    const config = Bun.TOML.parse(readFileSync(json.mcp.path, 'utf-8')) as Record<string, any>;
    expect(config.permissions.kevin.filesystem[join(homedir(), '.ssh', 'id_*')]).toBe('deny');
    expect(config.permissions.kevin.filesystem[join(homedir(), '.aws', '**')]).toBeUndefined();
    expect(config.permissions.kevin.filesystem[':workspace_roots']['**/*.pem']).toBe('deny');
    expect(JSON.stringify(config)).not.toContain('sudo');
    expect(json.notes).toEqual([expect.stringContaining('default_permissions')]);
  });

  test("keeps the operator's own policy keys and reports them, keeps their env entries, and refuses legacy sandbox keys", () => {
    const home = scratch();
    seed(
      home,
      'config.toml',
      'approvals_reviewer = "auto_review"\n\n[shell_environment_policy]\ninherit = "core"\nexclude = ["AWS_*", "AZURE_*"]\nset = { EDITOR = "vim" }\n'
    );
    const first = run('--home', home, '--plugin-root', PLUGIN, '--write');
    const config = Bun.TOML.parse(readFileSync(first.json.mcp.path, 'utf-8')) as Record<string, any>;
    expect(config.approvals_reviewer).toBe('auto_review');
    expect(config.default_permissions).toBe('kevin');
    expect(config.shell_environment_policy.inherit).toBe('core');
    expect(config.shell_environment_policy.exclude).toEqual(['AWS_*', 'AZURE_*']);
    expect(config.shell_environment_policy.set.EDITOR).toBe('vim');
    seed(
      home,
      'config.toml',
      '[shell_environment_policy]\nset = { EDITOR = "vim", AGENT_CODE_PATH = "/gone", KEVIN_GIT_REPOS = "/gone" }\n'
    );
    const regen = Bun.TOML.parse(
      readFileSync(run('--home', home, '--plugin-root', PLUGIN, '--write').json.mcp.path, 'utf-8')
    ) as Record<string, any>;
    expect(regen.shell_environment_policy.set).toEqual({ EDITOR: 'vim', AGENT_HOME: home, KEVIN_HOME: home });
    expect(first.json.notes).toEqual([expect.stringContaining('approvals_reviewer is "auto_review"')]);
    expect(run('--home', home, '--plugin-root', PLUGIN, '--write').json.mcp.changed).toBe(false);
    seed(home, 'config.toml', 'sandbox_mode = "workspace-write"\n');
    const { code, stderr } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    expect(code).not.toBe(0);
    expect(stderr).toContain('sandbox_mode');
  });

  test("keeps the operator's other settings and servers, replaces an older kevin registration", () => {
    const home = scratch();
    seed(
      home,
      'config.toml',
      [
        'model = "gpt-6"',
        '',
        '[mcp_servers.kevin]',
        'command = "bun"',
        'args = ["/old/kevin/mcp-server/src/server.ts"]',
        '',
        '[mcp_servers.kevin.env]',
        'AGENT_HOME = "/x"',
        '',
        '[mcp_servers.other]',
        'command = "other"',
        ''
      ].join('\n')
    );
    const { json } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    const written = readFileSync(json.mcp.path, 'utf-8');
    expect(written).toContain('model = "gpt-6"\n\n[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.kevin]\n');
    expect(written.startsWith('default_permissions = "kevin"\n')).toBe(true);
    expect(written).not.toContain('/old/kevin');
    expect(written).toContain(`AGENT_HOME = "${home}"`);
    expect(written.match(/\[mcp_servers\.kevin\]/g)).toHaveLength(1);
  });

  test('escapes backslashes in paths', () => {
    const home = join(scratch(), 'back\\slash');
    const { json } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    const written = readFileSync(json.mcp.path, 'utf-8');
    expect(written).toContain(`AGENT_HOME = ${JSON.stringify(home)}`);
    expect(Bun.TOML.parse(written)).toMatchObject({ mcp_servers: { kevin: { env: { AGENT_HOME: home } } } });
  });

  test("keeps the operator's own keys inside the kevin tables, and refuses one it cannot rewrite", () => {
    const home = scratch();
    seed(
      home,
      'config.toml',
      '[mcp_servers.kevin]\ncommand = "bun"\nstartup_timeout_sec = 60\n\n[mcp_servers.kevin.env]\nAGENT_HOME = "/x"\nSERPAPI_KEY = "k"\n'
    );
    const { json } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    const parsed = Bun.TOML.parse(readFileSync(json.mcp.path, 'utf-8')) as {
      mcp_servers: { kevin: { startup_timeout_sec: number; env: Record<string, string> } };
    };
    expect(parsed.mcp_servers.kevin.startup_timeout_sec).toBe(60);
    expect(parsed.mcp_servers.kevin.env).toEqual({
      AGENT_HOME: home,
      KEVIN_HOME: home,
      PLAYWRIGHT_BROWSERS_PATH: '0',
      SERPAPI_KEY: 'k'
    });
    seed(home, 'config.toml', '[mcp_servers.kevin]\ncommand = "bun"\n\n[mcp_servers.kevin.extra]\nnested = 1\n');
    const { code, stderr } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    expect(code).not.toBe(0);
    expect(stderr).toContain('cannot rewrite');
  });

  test('keeps an indented unrelated table that follows the kevin table', () => {
    const home = scratch();
    seed(home, 'config.toml', '[mcp_servers.kevin]\ncommand = "bun"\n\n  [mcp_servers.other]\ncommand = "keep-me"\n');
    const { json } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    const parsed = Bun.TOML.parse(readFileSync(json.mcp.path, 'utf-8')) as {
      mcp_servers: Record<string, { command: string; env?: Record<string, string> }>;
    };
    expect(parsed.mcp_servers.other.command).toBe('keep-me');
    expect(parsed.mcp_servers.kevin.env?.AGENT_HOME).toBe(home);
  });

  test('recognises a quoted kevin table and never registers kevin twice', () => {
    const home = scratch();
    seed(home, 'config.toml', '[mcp_servers."kevin"]\ncommand = "bun"\nargs = ["/old/kevin/server.ts"]\n');
    const { code, json } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    expect(code).toBe(0);
    const written = readFileSync(json.mcp.path, 'utf-8');
    expect(written.match(/\[mcp_servers\.("?)kevin\1\]/g)).toHaveLength(1);
    expect(Bun.TOML.parse(written)).toMatchObject({
      mcp_servers: { kevin: { args: [resolve(PLUGIN, 'mcp-server', 'src', 'server.ts')] } }
    });
  });

  test('leaves a multiline string with blank lines exactly as it was', () => {
    const home = scratch();
    const instructions = 'model_instructions = """\nfirst\n\n\nsecond\n"""\n';
    seed(home, 'config.toml', instructions);
    const { json } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    const written = readFileSync(json.mcp.path, 'utf-8');
    expect(written).toContain(instructions);
    const value = (text: string) => (Bun.TOML.parse(text) as { model_instructions: string }).model_instructions;
    expect(value(written)).toBe(value(instructions));
  });

  test('refuses malformed TOML and writes neither file', () => {
    const home = scratch();
    const path = seed(home, 'config.toml', 'model = [\n');
    const { code, stderr } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    expect(code).not.toBe(0);
    expect(stderr).toContain('not valid TOML');
    expect(readFileSync(path, 'utf-8')).toBe('model = [\n');
    expect(existsSync(join(home, '.codex', 'hooks.json'))).toBe(false);
  });

  test('refuses a kevin registration it cannot rewrite, such as an inline table, and writes nothing', () => {
    const home = scratch();
    const path = seed(home, 'config.toml', 'mcp_servers = { kevin = { command = "bun" } }\n');
    const { code, stderr } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    expect(code).not.toBe(0);
    expect(stderr).toContain('remove it by hand');
    expect(readFileSync(path, 'utf-8')).toBe('mcp_servers = { kevin = { command = "bun" } }\n');
    expect(existsSync(join(home, '.codex', 'hooks.json'))).toBe(false);
  });
});
