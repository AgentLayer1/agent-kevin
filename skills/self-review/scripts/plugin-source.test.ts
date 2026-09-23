import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'plugin-source.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A machine whose loaded plugin is a host cache copy, with a home and empty host registries. */
const machine = () => {
  const root = mkdtempSync(join(tmpdir(), 'plugin-source-'));
  dirs.push(root);
  const write = (rel: string, content: unknown) => {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  };
  const manifest = { name: 'agent-scout', repository: 'https://github.com/acme/agent-scout' };
  write('cache/.claude-plugin/plugin.json', manifest);
  mkdirSync(join(root, 'home', '.claude'), { recursive: true });
  mkdirSync(join(root, 'claude', 'plugins'), { recursive: true });
  mkdirSync(join(root, 'codex'), { recursive: true });
  /** A real git repository holding the plugin at `pluginRel` inside the catalog at `rel`. */
  const checkout = (rel: string, { name = 'agent-scout', pluginRel = '.' } = {}) => {
    const catalog = join(root, rel);
    write(`${rel}/.claude-plugin/marketplace.json`, {
      name: `agentdev-${name.replace(/^agent-/, '')}`,
      plugins: [{ name, source: `./${pluginRel}` }]
    });
    write(`${rel}/${pluginRel}/.claude-plugin/plugin.json`, { ...manifest, name });
    spawnSync('git', ['-C', catalog, 'init', '-q']);
    spawnSync('git', ['-C', catalog, 'add', '-A']);
    return { catalog, source: realpathSync(join(catalog, pluginRel)) };
  };
  const enableClaude = (marketplace: string, path: string) => {
    write('claude/plugins/known_marketplaces.json', {
      [marketplace]: { source: { source: 'directory', path } }
    });
    write('home/.claude/settings.json', { enabledPlugins: { [`agent-scout@${marketplace}`]: true } });
  };
  const enableCodex = (marketplace: string, path: string) => {
    write(
      'codex/config.toml',
      `[marketplaces.${marketplace}]\nsource_type = "local"\nsource = "${path}"\n\n[plugins."agent-scout@${marketplace}"]\nenabled = true\n`
    );
  };
  const run = (pluginRoot = join(root, 'cache'), homeDir = join(root, 'home')) => {
    const proc = spawnSync(process.execPath, [
      SCRIPT,
      '--plugin-root',
      pluginRoot,
      '--home',
      homeDir,
      '--claude-dir',
      join(root, 'claude'),
      '--codex-dir',
      join(root, 'codex')
    ]);
    return { status: proc.status, ...(proc.status === 0 ? JSON.parse(proc.stdout.toString()) : {}) };
  };
  return { root, write, checkout, enableClaude, enableCodex, run };
};

describe('plugin-source', () => {
  test('a marketplace install with no checkout is a consumer pointed upstream', () => {
    const { run } = machine();
    expect(run()).toMatchObject({
      mode: 'consumer',
      source: null,
      repository: 'https://github.com/acme/agent-scout'
    });
  });

  test('a Claude directory marketplace the home enables, on a git checkout, is a contributor', () => {
    const { checkout, enableClaude, run } = machine();
    const { catalog, source } = checkout('dev/agent-scout');
    enableClaude('agentdev-scout', catalog);
    expect(run()).toMatchObject({ mode: 'contributor', source, repo: source, hosts: ['claude'] });
  });

  test('a Codex local marketplace with the plugin enabled is a contributor', () => {
    const { checkout, enableCodex, run } = machine();
    const { catalog, source } = checkout('dev/agent-scout');
    enableCodex('agentdev-scout', catalog);
    expect(run()).toMatchObject({ mode: 'contributor', source, hosts: ['codex'] });
  });

  test('a registered checkout nobody enables the plugin from does not count', () => {
    const { write, checkout, run } = machine();
    const { catalog } = checkout('dev/agent-scout');
    write('claude/plugins/known_marketplaces.json', {
      'agentdev-scout': { source: { source: 'directory', path: catalog } }
    });
    expect(run()).toMatchObject({ mode: 'consumer', source: null });
  });

  test('a catalog holding the plugin below its git root resolves to the plugin directory', () => {
    const { checkout, enableClaude, run } = machine();
    const { catalog, source } = checkout('dev/catalog', { pluginRel: 'plugins/agent-scout' });
    enableClaude('agentdev-scout', catalog);
    expect(run()).toMatchObject({ mode: 'contributor', source, repo: realpathSync(catalog) });
  });

  test('a .git marker that git rejects is not a checkout', () => {
    const { root, write, enableClaude, run } = machine();
    write('dev/copy/.claude-plugin/plugin.json', { name: 'agent-scout' });
    write('dev/copy/.git', 'not a gitdir');
    enableClaude('agentdev-scout', join(root, 'dev', 'copy'));
    expect(run()).toMatchObject({ mode: 'consumer', source: null });
  });

  test('an untracked copy dropped inside some other repository is not a checkout', () => {
    const { root, write, enableClaude, run } = machine();
    spawnSync('git', ['-C', root, 'init', '-q']);
    write('dev/copy/.claude-plugin/plugin.json', { name: 'agent-scout' });
    enableClaude('agentdev-scout', join(root, 'dev', 'copy'));
    expect(run()).toMatchObject({ mode: 'consumer', source: null });
  });

  test("a checkout of another plugin does not count", () => {
    const { checkout, enableClaude, run } = machine();
    const { catalog } = checkout('dev/other', { name: 'agent-other' });
    enableClaude('agentdev-scout', catalog);
    expect(run()).toMatchObject({ mode: 'consumer', source: null });
  });

  test('a host cache that kept its git metadata is provenance, never a contributor checkout', () => {
    const { write, checkout, enableCodex, run } = machine();
    const cache = checkout('codex/plugins/cache/agentdev-scout/agent-scout/0.4.9');
    expect(run(cache.source)).toMatchObject({ mode: 'consumer', source: null, loaded: { cache: true } });
    const real = checkout('dev/agent-scout');
    enableCodex('agentdev-scout', real.catalog);
    write('codex/config.toml', `[marketplaces.agentdev-scout]\nsource_type = "local"\nsource = "${real.catalog}"\n\n[plugins."agent-scout@agentdev-scout"]\nenabled = true\n`);
    expect(run(cache.source)).toMatchObject({ mode: 'contributor', source: real.source });
  });

  test('an explicit false in the home wins over the install record', () => {
    const { root, write, checkout, enableClaude, run } = machine();
    const { catalog } = checkout('dev/agent-scout');
    enableClaude('agentdev-scout', catalog);
    write('claude/plugins/installed_plugins.json', {
      plugins: { 'agent-scout@agentdev-scout': [{ scope: 'project', projectPath: join(root, 'home') }] }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@agentdev-scout': false } });
    expect(run()).toMatchObject({ mode: 'consumer', source: null });
    write('home/.claude/settings.json', {});
    expect(run()).toMatchObject({ mode: 'contributor' });
  });

  test("a Codex catalog's object-shaped local source resolves to the nested plugin", () => {
    const { write, checkout, enableCodex, run } = machine();
    const { catalog, source } = checkout('dev/catalog', { pluginRel: 'plugins/agent-scout' });
    rmSync(join(catalog, '.claude-plugin'), { recursive: true });
    write('dev/catalog/.agents/plugins/marketplace.json', {
      name: 'agentdev-scout',
      plugins: [{ name: 'agent-scout', source: { source: 'local', path: './plugins/agent-scout' } }]
    });
    spawnSync('git', ['-C', catalog, 'add', '-A']);
    enableCodex('agentdev-scout', catalog);
    expect(run()).toMatchObject({ mode: 'contributor', source });
  });

  test('when git cannot run the resolver refuses to answer', () => {
    const { root, checkout, enableClaude } = machine();
    const { catalog } = checkout('dev/agent-scout');
    enableClaude('agentdev-scout', catalog);
    const proc = spawnSync(
      process.execPath,
      [SCRIPT, '--plugin-root', join(root, 'cache'), '--home', join(root, 'home'), '--claude-dir', join(root, 'claude'), '--codex-dir', join(root, 'codex')],
      { env: { ...process.env, PATH: '/nonexistent' } }
    );
    expect(proc.status).toBe(2);
    expect(proc.stderr.toString()).toContain('git could not check');
  });

  test('a relocated host directory (CLAUDE_CONFIG_DIR / CODEX_HOME) is honoured by default', () => {
    const { root, checkout } = machine();
    const cache = checkout('relocated/plugins/cache/agentdev-scout/agent-scout/0.4.9');
    const proc = spawnSync(process.execPath, [SCRIPT, '--plugin-root', cache.source, '--home', join(root, 'home')], {
      env: { ...process.env, CODEX_HOME: join(root, 'relocated'), CLAUDE_CONFIG_DIR: join(root, 'claude') }
    });
    expect(JSON.parse(proc.stdout.toString())).toMatchObject({ mode: 'consumer', loaded: { cache: true } });
  });

  test("the home's settings.local.json outranks its settings.json", () => {
    const { write, checkout, enableClaude, run } = machine();
    const { catalog } = checkout('dev/agent-scout');
    enableClaude('agentdev-scout', catalog);
    write('home/.claude/settings.local.json', { enabledPlugins: { 'agent-scout@agentdev-scout': false } });
    expect(run()).toMatchObject({ mode: 'consumer', source: null });
  });

  test("an install record for another project is not this home's enablement", () => {
    const { root, write, checkout, run } = machine();
    const { catalog } = checkout('dev/agent-scout');
    write('claude/plugins/known_marketplaces.json', {
      'agentdev-scout': { source: { source: 'directory', path: catalog } }
    });
    write('claude/plugins/installed_plugins.json', {
      plugins: { 'agent-scout@agentdev-scout': [{ scope: 'project', projectPath: join(root, 'elsewhere') }] }
    });
    expect(run()).toMatchObject({ mode: 'consumer', source: null });
    write('claude/plugins/installed_plugins.json', {
      plugins: { 'agent-scout@agentdev-scout': [{ scope: 'project', projectPath: join(root, 'home') }] }
    });
    expect(run()).toMatchObject({ mode: 'contributor' });
  });

  test('an install record for this home matches through a symlink to the home', () => {
    const { root, write, checkout, run } = machine();
    const { catalog } = checkout('dev/agent-scout');
    write('claude/plugins/known_marketplaces.json', {
      'agentdev-scout': { source: { source: 'directory', path: catalog } }
    });
    write('claude/plugins/installed_plugins.json', {
      plugins: { 'agent-scout@agentdev-scout': [{ scope: 'project', projectPath: join(root, 'home') }] }
    });
    symlinkSync(join(root, 'home'), join(root, 'home-alias'));
    expect(run(join(root, 'cache'), join(root, 'home-alias'))).toMatchObject({ mode: 'contributor' });
  });

  test('a git refusal with a normal exit status (dubious ownership) is not a consumer answer', () => {
    const { root, checkout, enableClaude } = machine();
    const { catalog } = checkout('dev/agent-scout');
    enableClaude('agentdev-scout', catalog);
    const proc = spawnSync(
      process.execPath,
      [SCRIPT, '--plugin-root', join(root, 'cache'), '--home', join(root, 'home'), '--claude-dir', join(root, 'claude'), '--codex-dir', join(root, 'codex')],
      { env: { ...process.env, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }
    );
    expect(proc.status).toBe(2);
    expect(proc.stderr.toString()).toContain('dubious ownership');
  });

  test('hosts enabled from different checkouts are ambiguous, with both named', () => {
    const { checkout, enableClaude, enableCodex, run } = machine();
    const claude = checkout('dev/claude-scout');
    const codex = checkout('dev/codex-scout');
    enableClaude('agentdev-scout', claude.catalog);
    enableCodex('agentdev-scout', codex.catalog);
    const result = run();
    expect(result.mode).toBe('ambiguous');
    expect(result.source).toBeNull();
    expect(result.candidates.map((item: { source: string }) => item.source).sort()).toEqual(
      [claude.source, codex.source].sort()
    );
  });
});
