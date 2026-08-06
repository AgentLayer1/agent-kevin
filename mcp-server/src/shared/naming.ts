import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Agent naming — the bottom of the config stack: this agent's env-var prefix,
 * the resolution rule that pairs it with the shared `AGENT_*` names, and the
 * name of its runtime data dir.
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

let cachedEnvPrefix: string | undefined;

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

// Resolved relative to this file, never an env var: wherever this code runs
// from (repo checkout, marketplace cache, fork) IS the plugin whose name it is.
const deriveEnvPrefix = (): string => {
  const manifestPath = resolve(import.meta.dir, '..', '..', '..', '.claude-plugin', 'plugin.json');
  const broken = (reason: string, cause?: unknown): Error =>
    new Error(
      `Cannot derive this agent's env prefix: ${reason} (${manifestPath}). Every per-agent override — ` +
        `<AGENT>_HOME, <AGENT>_CODE_PATH, <AGENT>_DB_* — would be ignored, and the home would fall back ` +
        `to a cwd walk-up. Fix the plugin manifest.`,
      { cause }
    );
  let name: unknown;
  try {
    name = (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { name?: unknown }).name;
  } catch (cause) {
    throw broken('the plugin manifest is missing or malformed', cause);
  }
  const short =
    typeof name === 'string'
      ? name
          .replace(/^agent-/, '')
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
      : '';
  if (!short) {
    throw broken(`the plugin manifest has no usable "name"`);
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
 * Folder name of the agent's runtime data dir — THE single place it's defined.
 * `.kevin` today; a future rename (or a conflict escape via the
 * `AGENT_RUNTIME_DIR` override) happens here.
 */
export const RUNTIME_DIR_DEFAULT = '.kevin';

// A bare folder name, enforced rather than documented: this value is joined onto
// HOME to locate the deny-gated secrets store, so a `/`, `\`, or `..` in it would
// walk the store (and every guard keyed on it) outside the home.
const BARE_FOLDER_NAME = /^[A-Za-z0-9._-]+$/;

/** The runtime data dir name in force: per-agent override, then shared, then the default. */
export const runtimeDirName = (): string => {
  const configured = resolveEnv('AGENT_RUNTIME_DIR');
  if (!configured) return RUNTIME_DIR_DEFAULT;
  if (!BARE_FOLDER_NAME.test(configured) || configured === '.' || configured === '..') {
    throw new Error(
      `${agentKeyName('RUNTIME_DIR')}/AGENT_RUNTIME_DIR must be a bare folder name (letters, digits, ".", "_", "-"), not a path — got "${configured}".`
    );
  }
  return configured;
};
