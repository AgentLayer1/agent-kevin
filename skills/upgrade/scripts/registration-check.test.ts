import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dir, 'registration-check.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A machine: a plugin checkout whose catalogs say `agentdev-scout`, a home, and empty host dirs. */
const machine = () => {
  const root = mkdtempSync(join(tmpdir(), 'registration-'));
  dirs.push(root);
  const write = (rel: string, value: unknown | string) => {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('plugin/.claude-plugin/plugin.json', { name: 'agent-scout', version: '0.4.1' });
  write('plugin/.claude-plugin/marketplace.json', { name: 'agentdev-scout', plugins: [] });
  write('plugin/.agents/plugins/marketplace.json', { name: 'agentdev-scout', plugins: [] });
  mkdirSync(join(root, 'home', '.claude'), { recursive: true });
  mkdirSync(join(root, 'claude', 'plugins'), { recursive: true });
  mkdirSync(join(root, 'codex'), { recursive: true });
  const run = () => {
    const proc = spawnSync(
      process.execPath,
      [
        SCRIPT,
        '--home',
        join(root, 'home'),
        '--plugin-root',
        join(root, 'plugin'),
        '--claude-dir',
        join(root, 'claude'),
        '--codex-dir',
        join(root, 'codex')
      ],
      { encoding: 'utf-8' }
    );
    if (proc.status !== 0) throw new Error(proc.stderr);
    return JSON.parse(proc.stdout);
  };
  return { root, write, run };
};

describe('registration-check', () => {
  test('a clean machine has nothing to do', () => {
    const { write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      'agentdev-scout': { source: { source: 'directory', path: 'x' } }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@agentdev-scout': true } });
    expect(run()).toMatchObject({ plugin: 'agent-scout', ok: true, findings: [], settings: {} });
  });

  test('a checkout registered under a name its catalog no longer carries: re-register, and flip both settings keys', () => {
    const { root, write, run } = machine();
    const checkout = join(root, 'plugin');
    write('claude/plugins/known_marketplaces.json', { scoutco: { source: { source: 'directory', path: checkout } } });
    write('claude/plugins/installed_plugins.json', { plugins: { 'agent-scout@scoutco': [{ scope: 'project' }] } });
    write('home/.claude/settings.json', {
      enabledPlugins: { 'agent-scout@scoutco': true },
      extraKnownMarketplaces: { scoutco: { source: { source: 'directory', path: checkout } } }
    });
    const result = run();
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({
        host: 'claude',
        kind: 'renamed-catalog',
        commands: [
          '/plugin marketplace remove scoutco',
          `/plugin marketplace add ${checkout}`,
          '/plugin install agent-scout@agentdev-scout'
        ]
      })
    ]);
    expect(result.settings).toEqual({
      enabledPlugins: { from: 'agent-scout@scoutco', to: 'agent-scout@agentdev-scout' },
      extraKnownMarketplaces: { from: 'scoutco', to: 'agentdev-scout' }
    });
  });

  test('a dev checkout and the published marketplace both registered: the key the home already uses stays', () => {
    const { root, write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      agentlayer: { source: { source: 'github', repo: 'AgentLayer1/agentlayer-agent-marketplace' } },
      'agentdev-scout': { source: { source: 'directory', path: join(root, 'plugin') } }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@agentdev-scout': true } });
    expect(run()).toMatchObject({ ok: true, settings: {} });
  });

  test('a key naming a marketplace that is not registered at all flips to the one that is', () => {
    const { root, write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      'agentdev-scout': { source: { source: 'directory', path: join(root, 'plugin') } }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@scoutco': true } });
    expect(run()).toMatchObject({
      ok: false,
      settings: { enabledPlugins: { from: 'agent-scout@scoutco', to: 'agent-scout@agentdev-scout' } }
    });
  });

  test('a retired marketplace repo: add the new one, nothing in the home changes', () => {
    const { write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      agentlayer: { source: { source: 'github', repo: 'AgentLayer1/agentlayer-claude-marketplace' } }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@agentlayer': true } });
    const result = run();
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'retired-marketplace',
        commands: [
          '/plugin marketplace add github:AgentLayer1/agentlayer-agent-marketplace',
          '/plugin install agent-scout@agentlayer'
        ]
      })
    ]);
    expect(result.settings).toEqual({});
  });

  test('a retired repo registered under another name moves the home key to the published name', () => {
    const { write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      'old-al': { source: { source: 'github', repo: 'AgentLayer1/agentlayer-claude-marketplace' } }
    });
    write('claude/plugins/installed_plugins.json', { plugins: { 'agent-scout@old-al': [{ scope: 'project' }] } });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@old-al': true } });
    const result = run();
    expect(result.findings[0].commands).toEqual([
      '/plugin marketplace add github:AgentLayer1/agentlayer-agent-marketplace',
      '/plugin install agent-scout@agentlayer'
    ]);
    expect(result.settings.enabledPlugins).toEqual({ from: 'agent-scout@old-al', to: 'agent-scout@agentlayer' });
  });

  test('a dangling key flips to the marketplace the plugin is installed from, not the first registered', () => {
    const { root, write, run } = machine();
    write('claude/plugins/known_marketplaces.json', {
      agentlayer: { source: { source: 'github', repo: 'AgentLayer1/agentlayer-agent-marketplace' } },
      'agentdev-scout': { source: { source: 'directory', path: join(root, 'plugin') } }
    });
    write('claude/plugins/installed_plugins.json', {
      plugins: { 'agent-scout@agentdev-scout': [{ scope: 'project' }] }
    });
    write('home/.claude/settings.json', { enabledPlugins: { 'agent-scout@gone': true } });
    expect(run().settings.enabledPlugins).toEqual({ from: 'agent-scout@gone', to: 'agent-scout@agentdev-scout' });
  });

  test('a registry that does not parse is a warning, and a null entry is skipped', () => {
    const { write, run } = machine();
    write('claude/plugins/known_marketplaces.json', '{ nope');
    write('codex/config.toml', 'model = [\n');
    const result = run();
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(2);
    write('claude/plugins/known_marketplaces.json', { agentlayer: null });
    expect(run().ok).toBe(true);
  });

  test('a Codex local marketplace registered under a stale name', () => {
    const { root, write, run } = machine();
    const checkout = join(root, 'plugin');
    write(
      'codex/config.toml',
      `[marketplaces.scoutco]\nsource_type = "local"\nsource = "${checkout}"\n\n[plugins."agent-scout@scoutco"]\nenabled = true\n`
    );
    const result = run();
    expect(result.findings).toEqual([
      expect.objectContaining({
        host: 'codex',
        commands: [
          'codex plugin remove agent-scout@scoutco',
          'codex plugin marketplace remove scoutco',
          `codex plugin marketplace add ${checkout}`,
          'codex plugin add agent-scout@agentdev-scout'
        ]
      })
    ]);
  });
});
