import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Agent naming — the bottom of the config stack: this agent's env-var prefix,
 * the resolution rule that pairs it with the shared `AGENT_*` names, the name
 * of its runtime data dir, and how a data dir is recognised as this agent's.
 *
 * Env naming: every knob has a shared, agent-neutral `AGENT_*` name — the one
 * code reads, docs teach, and machine-level settings (`~/.claude/settings.json`)
 * can set once for every agent on the box. Each agent overrides any of them
 * under its own prefix (`KEVIN_*`, `SCOUT_*`, …), derived from the plugin
 * manifest name by `agentEnvPrefix()`; the override always wins, so the fork
 * seam lives in plugin.json, not in code.
 *
 * Side-effect-free by contract, and it imports nothing beyond node builtins.
 * `shared/env.ts` sits directly on top and adds secrets loading — which reads a
 * home's `secrets/.env` into `process.env` on import. Anything that needs only
 * a NAME imports from here so it doesn't drag that load in: `shared/log.ts`
 * (which must stay light enough for hook scripts), `test.ts` (which pins
 * `AGENT_HOME` before any secrets can load from the wrong home), and
 * `status/html-render.ts` (whose runtime imports must stay config-free). Keep
 * it that way.
 *
 * When adding a var, avoid names CI systems inject — Azure Pipelines sets
 * `AGENT_OS`, `AGENT_NAME`, `AGENT_HOMEDIRECTORY`, and friends on every build
 * agent.
 */

let cachedPluginName: string | undefined;
let cachedEnvPrefix: string | undefined;

// Resolved relative to this file, never an env var: wherever this code runs
// from (repo checkout, marketplace cache, fork) IS the plugin whose name it is.
const MANIFEST_PATH = resolve(import.meta.dir, '..', '..', '..', '.claude-plugin', 'plugin.json');

const brokenManifest = (reason: string, cause?: unknown): Error =>
  new Error(
    `Cannot derive this agent's env prefix: ${reason} (${MANIFEST_PATH}). Every per-agent override — ` +
      `<AGENT>_HOME, <AGENT>_CODE_PATH, <AGENT>_DB_* — would be ignored, and the home would fall back ` +
      `to a cwd walk-up. Fix the plugin manifest.`,
    { cause }
  );

/**
 * This plugin's manifest name (`agent-kevin`), read once. Throws when the
 * manifest can't be read; only successes are cached, so a transient read
 * failure can't poison the process.
 */
export const pluginName = (): string => {
  if (cachedPluginName === undefined) {
    cachedPluginName = readPluginName();
  }
  return cachedPluginName;
};

const readPluginName = (): string => {
  let name: unknown;
  try {
    name = (JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as { name?: unknown }).name;
  } catch (cause) {
    throw brokenManifest('the plugin manifest is missing or malformed', cause);
  }
  if (typeof name !== 'string' || !name) {
    throw brokenManifest(`the plugin manifest has no usable "name"`);
  }
  return name;
};

/**
 * This agent's own env-var prefix (`KEVIN_` for the `agent-kevin` plugin),
 * derived once from the plugin manifest name — `agent-<name>` → `<NAME>_`.
 * Throws when the manifest can't be read: an empty prefix would make every
 * per-agent override silently invisible, and only successes are cached, so a
 * transient read failure can't poison the process.
 */
export const agentEnvPrefix = (): string => {
  if (cachedEnvPrefix === undefined) {
    cachedEnvPrefix = deriveEnvPrefix();
  }
  return cachedEnvPrefix;
};

const deriveEnvPrefix = (): string => {
  const short = pluginName()
    .replace(/^agent-/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!short) {
    throw brokenManifest(`the plugin manifest has no usable "name"`);
  }
  return `${short}_`;
};

/** Raw read of a key's per-agent override. Trimmed, or undefined when unset/blank. */
const overrideValue = (key: string): string | undefined => {
  if (!key.startsWith('AGENT_')) return undefined;
  return process.env[agentEnvPrefix() + key.slice('AGENT_'.length)]?.trim() || undefined;
};

/**
 * Read one `process.env` value under the shared/override rule: an `AGENT_*`
 * key's per-agent spelling (e.g. `KEVIN_*`) wins over the shared name. Trimmed,
 * or `undefined` when unset/blank. `env()` in `shared/env.ts` is this plus
 * secrets loading — prefer that everywhere except `shared/log.ts`, which must
 * stay off the secrets path.
 */
export const resolveEnv = (key: string): string | undefined =>
  overrideValue(key) || process.env[key]?.trim() || undefined;

/**
 * This agent's spelling of a key suffix (`agentKeyName('CODE_PATH')` →
 * `KEVIN_CODE_PATH`) — for user-facing hints and error messages, so they teach
 * the name that actually resolves.
 */
export const agentKeyName = (suffix: string): string => `${agentEnvPrefix()}${suffix}`;

/**
 * Folder name of the agent's runtime data dir. Fixed, not configurable: skill
 * text and init's secrets deny rules spell it out, so a renamed dir would sit
 * outside every sandbox rule.
 */
export const RUNTIME_DIR = '.kevin';

/**
 * Files that mark a data dir as a scaffolded agent home: the upgrade baseline
 * (`version.json`, written by init) and the compile cursor (`knowledge.json`).
 * The bare directory is NOT the marker — best-effort runtime writers (the
 * logger) can create the dir itself as a side effect in a tree that is not a
 * home, and a marker that can be minted that way lets a hook firing in a
 * foreign repo turn that repo into "the home" for every later guard. Both
 * files are git-tracked in a brain repo, so a fresh clone still resolves.
 */
export const HOME_MARKER_FILES = ['version.json', 'knowledge.json'] as const;

/**
 * The plugin a data dir's `version.json` says scaffolded it, or undefined when
 * the file is missing, unreadable, or predates the `plugin` field.
 */
export const recordedPlugin = (dataDir: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(dataDir, 'version.json'), 'utf-8'));
    return typeof parsed === 'object' && parsed !== null && 'plugin' in parsed && typeof parsed.plugin === 'string'
      ? parsed.plugin
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * True when `dataDir` carries a home marker and was scaffolded by this plugin.
 * The folder name alone can't tell two agents apart once they share it, so a
 * recorded plugin must be this one; an unrecorded one still matches, which
 * keeps every home from before the field resolving.
 */
export const isOwnDataDir = (dataDir: string): boolean => {
  if (!HOME_MARKER_FILES.some((file) => existsSync(resolve(dataDir, file)))) {
    return false;
  }
  const recorded = recordedPlugin(dataDir);
  return recorded === undefined || recorded === pluginName();
};
