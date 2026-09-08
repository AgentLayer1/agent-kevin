import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const run = (...extra: string[]) => {
  const proc = spawnSync(process.execPath, [SCRIPT, ...extra], { encoding: 'utf-8' });
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
  test('writes the kevin server with the home pinned in its env', () => {
    const home = scratch();
    const { json } = run('--home', home, '--plugin-root', PLUGIN, '--write');
    expect(json.mcp).toEqual({ path: join(home, '.codex', 'config.toml'), changed: true });
    expect(json.entries).toBe(4);
    expect(readFileSync(json.mcp.path, 'utf-8')).toBe(
      [
        '[mcp_servers.kevin]',
        'command = "bun"',
        `args = [${JSON.stringify(resolve(PLUGIN, 'mcp-server', 'src', 'server.ts'))}]`,
        '',
        '[mcp_servers.kevin.env]',
        `AGENT_HOME = ${JSON.stringify(home)}`,
        `KEVIN_HOME = ${JSON.stringify(home)}`,
        'PLAYWRIGHT_BROWSERS_PATH = "0"',
        ''
      ].join('\n')
    );
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
    expect(
      written.startsWith('model = "gpt-6"\n\n[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.kevin]\n')
    ).toBe(true);
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
    expect(written.startsWith(instructions)).toBe(true);
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
