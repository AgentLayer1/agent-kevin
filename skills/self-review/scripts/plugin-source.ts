#!/usr/bin/env bun
/**
 * Where can a self-review finding about the plugin itself land? `contributor` names the git
 * checkout the enabled plugin is registered from on either host; `consumer` means the only copy
 * is a host-managed cache the next update overwrites; `ambiguous` means the hosts point at
 * different checkouts and the operator picks. Read-only; exits 2 when it could not check.
 *
 * Usage: plugin-source.ts [--plugin-root <dir>] [--home <dir>] [--claude-dir <dir>] [--codex-dir <dir>]
 * Host dirs default to CLAUDE_CONFIG_DIR / CODEX_HOME, then ~/.claude and ~/.codex.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { agentHomePath } from '../../../mcp-server/src/shared/env';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
/** One spelling per existing directory, so a symlinked home and its target compare equal. */
const canonical = (path: string): string => (existsSync(path) ? realpathSync(path) : resolve(path));
const pluginRoot = resolve(flag('plugin-root') ?? join(import.meta.dir, '..', '..', '..'));
const homeDir = canonical(flag('home') ?? agentHomePath());
const claudeDir = resolve(flag('claude-dir') ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'));
const codexDir = resolve(flag('codex-dir') ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'));

const isRecord = (input: unknown): input is Record<string, unknown> => typeof input === 'object' && input !== null;
const readJson = (path: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const readToml = (path: string): Record<string, unknown> => {
  try {
    const parsed: unknown = Bun.TOML.parse(readFileSync(path, 'utf-8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const recordEntries = (input: unknown): [string, Record<string, unknown>][] =>
  Object.entries(isRecord(input) ? input : {}).filter((entry): entry is [string, Record<string, unknown>] =>
    isRecord(entry[1])
  );

const manifest = readJson(join(pluginRoot, '.claude-plugin', 'plugin.json'));
const plugin = typeof manifest.name === 'string' ? manifest.name : '';
if (!plugin) {
  process.stderr.write(`${pluginRoot} has no .claude-plugin/plugin.json\n`);
  process.exit(2);
}
const repository = typeof manifest.repository === 'string' ? manifest.repository : null;

type Host = 'loaded' | 'claude' | 'codex';
interface Candidate {
  host: Host;
  marketplace: string | null;
  source: string;
  repo: string;
}

// Host caches are provenance, never an edit target, even when the host kept git metadata in them.
const cacheRoots = [join(claudeDir, 'plugins', 'cache'), join(codexDir, 'plugins', 'cache')].map((dir) =>
  existsSync(dir) ? realpathSync(dir) : dir
);
const underCache = (dir: string): boolean => cacheRoots.some((root) => dir === root || dir.startsWith(root + sep));

/** A catalog may hold the plugin below its root; each host's own marketplace.json says where.
 *  Claude entries carry a relative `source` string, Codex entries `{ source: 'local', path }`. */
const pluginDirInCatalog = (host: Host, catalogDir: string): string | null => {
  const catalog =
    host === 'codex'
      ? join(catalogDir, '.agents', 'plugins', 'marketplace.json')
      : join(catalogDir, '.claude-plugin', 'marketplace.json');
  const plugins = readJson(catalog).plugins;
  const entry = (Array.isArray(plugins) ? plugins.filter(isRecord) : []).find((item) => item.name === plugin);
  if (!entry) return existsSync(catalog) ? null : catalogDir;
  const source = entry.source;
  if (typeof source === 'string') return resolve(catalogDir, source);
  if (isRecord(source) && source.source === 'local' && typeof source.path === 'string') {
    return resolve(catalogDir, source.path);
  }
  return null;
};

/** Runs git and tells a negative answer ("not a repository", "not tracked") from a refusal to
 *  answer (git missing, killed, dubious ownership, permissions): a refusal ends the run with
 *  exit 2 rather than passing for `consumer`. */
const git = (dir: string, expectedFailure: RegExp, ...gitArgs: string[]): string | null => {
  const proc = spawnSync('git', ['-C', dir, ...gitArgs], { encoding: 'utf-8' });
  if (proc.status === 0) return proc.stdout.trim();
  if (!proc.error && proc.status !== null && expectedFailure.test(proc.stderr)) return null;
  const reason = proc.error?.message ?? proc.stderr.trim() ?? 'no exit status';
  process.stderr.write(`git could not check ${dir} (${reason}); install mode not resolved\n`);
  process.exit(2);
};
/** A checkout is a directory whose plugin manifest git tracks: a copy dropped inside some other
 *  repository has a toplevel but no tracked manifest. */
const candidate = (host: Host, marketplace: string | null, dir: string): Candidate | null => {
  const source = pluginDirInCatalog(host, resolve(dir));
  if (source === null || !existsSync(source)) return null;
  const real = realpathSync(source);
  const manifestPath = join(real, '.claude-plugin', 'plugin.json');
  if (underCache(real) || readJson(manifestPath).name !== plugin) return null;
  const repo = git(real, /not a git repository|invalid gitfile format/, 'rev-parse', '--show-toplevel');
  const tracked =
    repo !== null && git(real, /did not match|pathspec/, 'ls-files', '--error-unmatch', manifestPath) !== null;
  return tracked ? { host, marketplace, source: real, repo } : null;
};

// Claude Code: settings decide in the host's precedence order (the home's local file, the home's
// shared file, the user's); the install record only says the plugin was installed somewhere, so it
// counts only when no settings file has an opinion and an entry belongs to this home or the user.
const enabledIn = (path: string, id: string): boolean | undefined => {
  const enabledPlugins = readJson(path).enabledPlugins;
  const value = isRecord(enabledPlugins) ? enabledPlugins[id] : undefined;
  return typeof value === 'boolean' ? value : undefined;
};
const installed = readJson(join(claudeDir, 'plugins', 'installed_plugins.json')).plugins;
const installedHere = (id: string): boolean => {
  const entries = isRecord(installed) ? installed[id] : undefined;
  return (
    Array.isArray(entries) &&
    entries
      .filter(isRecord)
      .some((entry) => entry.scope === 'user' || (typeof entry.projectPath === 'string' && canonical(entry.projectPath) === homeDir))
  );
};
const claudeEnabled = (id: string): boolean =>
  enabledIn(join(homeDir, '.claude', 'settings.local.json'), id) ??
  enabledIn(join(homeDir, '.claude', 'settings.json'), id) ??
  enabledIn(join(claudeDir, 'settings.json'), id) ??
  installedHere(id);
const claudeCandidates = recordEntries(readJson(join(claudeDir, 'plugins', 'known_marketplaces.json')))
  .filter(([name]) => claudeEnabled(`${plugin}@${name}`))
  .map(([name, registration]) => [name, registration.source] as const)
  .filter((entry): entry is readonly [string, Record<string, unknown>] => isRecord(entry[1]))
  .filter(([, source]) => source.source === 'directory' && typeof source.path === 'string')
  .map(([name, source]) => candidate('claude', name, String(source.path)));

// Codex: local marketplaces and plugins are user-scoped tables in config.toml.
const codexConfig = readToml(join(codexDir, 'config.toml'));
const codexEnabled = new Set(
  recordEntries(codexConfig.plugins)
    .filter(([, entry]) => entry.enabled !== false)
    .map(([id]) => id)
);
const codexCandidates = recordEntries(codexConfig.marketplaces)
  .filter(([name, marketplace]) => codexEnabled.has(`${plugin}@${name}`) && marketplace.source_type === 'local')
  .filter(([, marketplace]) => typeof marketplace.source === 'string')
  .map(([name, marketplace]) => candidate('codex', name, String(marketplace.source)));

const candidates = [candidate('loaded', null, pluginRoot), ...claudeCandidates, ...codexCandidates].filter(
  (item): item is Candidate => item !== null
);
const sources = [...new Set(candidates.map((item) => item.source))];
const mode = sources.length === 0 ? 'consumer' : sources.length === 1 ? 'contributor' : 'ambiguous';
const chosen = mode === 'contributor' ? candidates[0] : undefined;

process.stdout.write(
  `${JSON.stringify(
    {
      plugin,
      mode,
      loaded: { path: pluginRoot, cache: underCache(existsSync(pluginRoot) ? realpathSync(pluginRoot) : pluginRoot) },
      source: chosen?.source ?? null,
      repo: chosen?.repo ?? null,
      hosts: [...new Set(candidates.map((item) => item.host))],
      candidates: mode === 'ambiguous' ? candidates : [],
      repository
    },
    null,
    2
  )}\n`
);
