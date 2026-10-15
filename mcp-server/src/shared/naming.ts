import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Agent naming — the bottom of the config stack: how env keys resolve, the name
 * of its runtime data dir, and how a data dir is recognised as this agent's.
 *
 * Env naming: every knob has one shared, agent-neutral `AGENT_*` name, the only
 * one code reads. Several homes can run one plugin, so a per-agent spelling could
 * never mean "this agent only"; per-home values live in the home's own settings.
 * The plugin's legacy prefix (`KEVIN_*`, from the manifest name) survives only to
 * recognise, mask, and migrate keys from homes set up before 0.8.0.
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
    `Cannot read this plugin's name: ${reason} (${MANIFEST_PATH}). Its data dir can't be recognised ` +
      `and legacy keys can't be found. Fix the plugin manifest.`,
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
 * The prefix keys carried before 0.8.0 (`KEVIN_` for `agent-kevin`), derived once from the
 * manifest name. Nothing resolves it; it only finds legacy keys to migrate, mask, or flag.
 */
export const legacyEnvPrefix = (): string => {
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

/**
 * Read one `process.env` value, trimmed, or `undefined` when unset/blank. `env()` in
 * `shared/env.ts` is this plus secrets loading — prefer that everywhere except
 * `shared/log.ts`, which must stay off the secrets path.
 */
export const resolveEnv = (key: string): string | undefined => process.env[key]?.trim() || undefined;

/**
 * Folder name of the agent's runtime data dir, shared by every agent: a home's
 * `version.json` records which plugin owns it. Fixed, not configurable: skill
 * text and init's secrets deny rules spell it out.
 */
export const RUNTIME_DIR = '.state';

/**
 * Files that mark a data dir as some agent's scaffolded home: the upgrade baseline
 * (`version.json`, written by init) and the compile cursor (`knowledge.json`).
 * This agent's own home is narrower: its `version.json` records this plugin.
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
      ? parsed.plugin || undefined
      : undefined;
  } catch {
    return undefined;
  }
};

/** True when `dataDir`'s `version.json` records this plugin; the shared `.state` name proves nothing on its own. */
export const isOwnDataDir = (dataDir: string): boolean => recordedPlugin(dataDir) === pluginName();

/** `home`'s `.state` when it is this agent's data dir; undefined when `home` is not this agent's home. */
export const ownDataDir = (home: string): string | undefined => {
  const dataDir = resolve(home, RUNTIME_DIR);
  return isOwnDataDir(dataDir) ? dataDir : undefined;
};

/** Where `home` keeps its runtime state, whether or not init has written it yet. */
export const dataDirOf = (home: string): string => resolve(home, RUNTIME_DIR);
