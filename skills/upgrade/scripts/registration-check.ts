#!/usr/bin/env bun
/**
 * Preflight for the upgrade skill: is this plugin registered the way the current release
 * expects, on Claude Code and on Codex? Reads the host registries and the home's settings,
 * never writes, and prints each finding with the exact commands that fix it plus the
 * settings keys the skill flips itself.
 *
 * Usage: registration-check.ts --home <dir> [--plugin-root <dir>] [--claude-dir <dir>] [--codex-dir <dir>]
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Where consumers install from, and the marketplace repos that name replaced. */
const PUBLISHED = {
  name: 'agentlayer',
  repo: 'AgentLayer1/agentlayer-agent-marketplace',
  retired: ['AgentLayer1/agentlayer-claude-marketplace']
};

interface Finding {
  host: 'claude' | 'codex';
  kind: 'renamed-catalog' | 'retired-marketplace';
  detail: string;
  commands: string[];
}
interface KeyFlip {
  from: string;
  to: string;
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const home = flag('home');
if (!home) {
  process.stderr.write(
    'usage: registration-check.ts --home <dir> [--plugin-root <dir>] [--claude-dir <dir>] [--codex-dir <dir>]\n'
  );
  process.exit(2);
}
const homeDir = resolve(home);
const pluginRoot = resolve(flag('plugin-root') ?? resolve(import.meta.dir, '..', '..', '..'));
const claudeDir = resolve(flag('claude-dir') ?? resolve(homedir(), '.claude'));
const codexDir = resolve(flag('codex-dir') ?? resolve(homedir(), '.codex'));

const readJson = (path: string): Record<string, unknown> | undefined => {
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
};
const catalogName = (dir: string): string | undefined => {
  const claude = readJson(resolve(dir, '.claude-plugin', 'marketplace.json'))?.name;
  const codex = readJson(resolve(dir, '.agents', 'plugins', 'marketplace.json'))?.name;
  return typeof claude === 'string' ? claude : typeof codex === 'string' ? codex : undefined;
};

const plugin = String(readJson(resolve(pluginRoot, '.claude-plugin', 'plugin.json'))?.name ?? '');
if (!plugin) {
  throw new Error(`${pluginRoot} has no .claude-plugin/plugin.json`);
}
const devName = catalogName(pluginRoot);
const findings: Finding[] = [];
const settings: { enabledPlugins?: KeyFlip; extraKnownMarketplaces?: KeyFlip } = {};

// Claude Code: the user's marketplace registry, keyed by marketplace name.
interface Registration {
  source?: { source?: string; path?: string; repo?: string };
}
const known = (readJson(resolve(claudeDir, 'plugins', 'known_marketplaces.json')) ?? {}) as Record<
  string,
  Registration
>;
const installed = (readJson(resolve(claudeDir, 'plugins', 'installed_plugins.json'))?.plugins ?? {}) as Record<
  string,
  unknown
>;
const relevant = Object.entries(known).filter(
  ([name]) => name === PUBLISHED.name || name === devName || `${plugin}@${name}` in installed
);
const validIds: string[] = [];
const renamed = new Map<string, string>();
for (const [name, registration] of relevant) {
  const source = registration.source ?? {};
  if (source.source === 'directory' && source.path) {
    const catalog = catalogName(source.path);
    if (catalog && catalog !== name) {
      findings.push({
        host: 'claude',
        kind: 'renamed-catalog',
        detail: `Marketplace "${name}" is registered from ${source.path}, whose catalog is now named "${catalog}"; the plugin id becomes ${plugin}@${catalog}.`,
        commands: [
          `/plugin marketplace remove ${name}`,
          `/plugin marketplace add ${source.path}`,
          `/plugin install ${plugin}@${catalog}`
        ]
      });
      renamed.set(name, catalog);
      validIds.push(`${plugin}@${catalog}`);
      continue;
    }
  }
  if (source.source === 'github' && source.repo && PUBLISHED.retired.includes(source.repo)) {
    findings.push({
      host: 'claude',
      kind: 'retired-marketplace',
      detail: `Marketplace "${name}" still points at ${source.repo}; the catalog moved to ${PUBLISHED.repo} under the same name, so adding it replaces the registration and ${plugin}@${name} is unchanged.`,
      commands: [`/plugin marketplace add github:${PUBLISHED.repo}`]
    });
  }
  validIds.push(`${plugin}@${name}`);
}
const homeSettings = readJson(resolve(homeDir, '.claude', 'settings.json')) ?? {};
const enabledKey = Object.keys(homeSettings.enabledPlugins ?? {}).find((key) => key.startsWith(`${plugin}@`));
if (enabledKey && validIds.length > 0 && !validIds.includes(enabledKey)) {
  const marketplace = enabledKey.slice(plugin.length + 1);
  const target = renamed.get(marketplace);
  settings.enabledPlugins = { from: enabledKey, to: target ? `${plugin}@${target}` : validIds[0] };
}
const staleMarketplace = Object.keys(homeSettings.extraKnownMarketplaces ?? {}).find((key) => renamed.has(key));
if (staleMarketplace) {
  settings.extraKnownMarketplaces = { from: staleMarketplace, to: String(renamed.get(staleMarketplace)) };
}

// Codex: marketplaces and plugins are user-scoped tables in config.toml.
interface CodexConfig {
  marketplaces?: Record<string, { source_type?: string; source?: string }>;
  plugins?: Record<string, unknown>;
}
const codexConfigPath = resolve(codexDir, 'config.toml');
if (existsSync(codexConfigPath)) {
  const config = Bun.TOML.parse(readFileSync(codexConfigPath, 'utf-8')) as CodexConfig;
  for (const [name, marketplace] of Object.entries(config.marketplaces ?? {})) {
    if (marketplace.source_type !== 'local' || !marketplace.source) continue;
    const catalog = catalogName(marketplace.source);
    if (!catalog || catalog === name || !(`${plugin}@${name}` in (config.plugins ?? {}))) continue;
    findings.push({
      host: 'codex',
      kind: 'renamed-catalog',
      detail: `Codex marketplace "${name}" is registered from ${marketplace.source}, whose catalog is now named "${catalog}"; the plugin id becomes ${plugin}@${catalog}.`,
      commands: [
        `codex plugin remove ${plugin}@${name}`,
        `codex plugin marketplace remove ${name}`,
        `codex plugin marketplace add ${marketplace.source}`,
        `codex plugin add ${plugin}@${catalog}`
      ]
    });
  }
}

process.stdout.write(`${JSON.stringify({ plugin, ok: findings.length === 0, findings, settings }, null, 2)}\n`);
