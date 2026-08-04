import { expandTilde } from '@/shared/paths';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

/**
 * The ONE place the codebase reads `process.env`.
 *
 * Convention: a literal `process.env.<X>` / `process.env[x]` appears nowhere
 * else. The sole other exception is `shared/log.ts` — a self-contained logger
 * that must stay dependency-free. Everything else reads through `env()` (or a
 * helper here). A guard test enforces this — see `config.test.ts`.
 *
 * Why this lives apart from `config.ts`: config imports this module, so the
 * dependency only runs one way — and keeping the env gate at the bottom of the
 * stack means a tool (or its test) can read env without pulling the whole layout
 * in. Both resolve from `AGENT_HOME` at read time rather than at import.
 *
 * Env naming: every knob has a shared, agent-neutral `AGENT_*` name — the one
 * code reads, docs teach, and machine-level settings (`~/.claude/settings.json`)
 * can set once for every agent on the box. Each agent overrides any of them
 * under its own prefix (`KEVIN_*`, `WALLE_*`, …), derived from the plugin
 * manifest name by `agentEnvPrefix()`; the override always wins, so the fork
 * seam lives in plugin.json, not in code. When adding a var, avoid names CI
 * systems inject — Azure Pipelines sets `AGENT_OS`, `AGENT_NAME`,
 * `AGENT_HOMEDIRECTORY`, and friends on every build agent.
 *
 * Robustness: `env()` triggers `loadSecretsEnv()` first, and that load is keyed on
 * the resolved secrets file, so secrets are populated from the CURRENT home no
 * matter who imported what, in what order. There is no import-order discipline to
 * forget.
 */

let cachedEnvPrefix: string | undefined;

/**
 * This agent's own env-var prefix (`KEVIN_` for the `agent-kevin` plugin),
 * derived once from the plugin manifest name — `agent-<name>` → `<NAME>_`.
 * Empty string when no manifest is readable; the shared `AGENT_*` names then
 * stand alone.
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
  try {
    const manifestPath = resolve(import.meta.dir, '..', '..', '..', '.claude-plugin', 'plugin.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { name?: unknown };
    const name = typeof manifest.name === 'string' ? manifest.name : '';
    const short = name
      .replace(/^agent-/, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return short ? `${short}_` : '';
  } catch {
    return '';
  }
};

/** The per-agent spelling of a shared `AGENT_*` key, or undefined when there is no prefix. */
const overrideKeyFor = (key: string): string | undefined => {
  const prefix = agentEnvPrefix();
  return prefix && key.startsWith('AGENT_') ? prefix + key.slice('AGENT_'.length) : undefined;
};

/** Raw read of a key's per-agent override. Trimmed, or undefined when unset/blank. */
const overrideValue = (key: string): string | undefined => {
  const overrideKey = overrideKeyFor(key);
  return overrideKey ? process.env[overrideKey]?.trim() || undefined : undefined;
};

/**
 * Folder name of the agent's runtime data dir — THE single place it's defined.
 * `.kevin` today; a future rename (or a conflict escape via the
 * `AGENT_RUNTIME_DIR` override — a bare folder name, not a path) happens here.
 * Read raw from `process.env`: the secrets loader itself resolves through this,
 * so it cannot go through `env()`. `shared/log.ts` mirrors this read inline to
 * stay dependency-free.
 */
export const RUNTIME_DIR_DEFAULT = '.kevin';
export const runtimeDirName = (): string =>
  overrideValue('AGENT_RUNTIME_DIR') || process.env.AGENT_RUNTIME_DIR?.trim() || RUNTIME_DIR_DEFAULT;

/**
 * Resolve the agent HOME: the per-agent override (e.g. `KEVIN_HOME`) or shared
 * `AGENT_HOME` when set, else the nearest ancestor of cwd (cwd included)
 * carrying this agent's data dir (`runtimeDirName()`, created at init). A bare
 * cwd fallback anchors to wherever the process happened to launch; for a
 * session launched inside a code repo that puts session captures, data-dir
 * state, and logs INSIDE the repo, so the walk-up refuses to anchor on
 * anything that isn't this agent's scaffolded home. The data dir (not SOUL.md)
 * is the marker because it's agent-specific: every sibling agent's home
 * carries a SOUL.md, but only this agent's carries the data dir, so the walk
 * can never anchor on another agent's brain. Falls back to cwd only when no
 * home exists on the ancestor path (the pre-init case). Any resolved home is
 * written back to `process.env.AGENT_HOME` (the canonical name) so the
 * dependency-free logger and child processes inherit it; the cwd fallback is
 * never written back.
 */
export function agentHomePath(): string {
  const fromVar = overrideValue('AGENT_HOME') || process.env.AGENT_HOME?.trim();
  if (fromVar) {
    const expanded = expandTilde(fromVar);
    process.env.AGENT_HOME = expanded;
    return expanded;
  }
  let dir = process.cwd();
  for (;;) {
    if (isAgentHome(dir)) {
      process.env.AGENT_HOME = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return process.cwd();
    }
    dir = parent;
  }
}

/**
 * True when `path` is this agent's scaffolded home — marked by its data dir,
 * which no sibling agent's home carries. Guards use this to fail loud instead
 * of writing into a repo or another agent's tree.
 */
export const isAgentHome = (path: string): boolean => existsSync(resolve(expandTilde(path), runtimeDirName()));

/** `<HOME>/<data-dir>/secrets/.env`, resolved live (never frozen) so a test that sets AGENT_HOME is honoured. */
const secretsEnvFile = (): string => resolve(agentHomePath(), runtimeDirName(), 'secrets', '.env');

/**
 * Minimal dotenv parser — private. Handing a raw env-file parser (or raw secret
 * values) to other modules is a leak vector. `KEY=value`; `#` comments and blank
 * lines ignored; surrounding quotes stripped.
 */
function parseDotenv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** `<HOME>/<data-dir>/secrets` — the deny-gated store holding the agent's own secrets. */
const secretsDir = (): string => dirname(secretsEnvFile());

/**
 * Parse a standalone `.env` file into a plain map — for callers that inject
 * scoped secrets into a *child* process's env WITHOUT polluting this process's
 * `process.env` (which would leak them into the global secret inventory and
 * every other tool). The browser-flows dispatcher uses it to hand one flow its
 * own credentials, so they never travel as tool params through the conversation.
 * Returns `{}` when the file is absent or unreadable — the normal case for a
 * flow that needs no secrets. Never throws. Values are raw: the caller must not
 * log them.
 *
 * Guard: this reader can NEVER touch the agent's own secret store
 * (`<HOME>/<data-dir>/secrets/`). That dir holds the agent's operational keys
 * (GitHub, Google, DB URLs); a flow-scoped loader must not be a path back into
 * it. Any path resolving inside the secrets dir returns `{}` — those secrets
 * flow only through `env()`, never this seam.
 */
export function readEnvFile(path: string): Record<string, string> {
  const resolved = resolve(path);
  const gated = secretsDir();
  if (resolved === gated || resolved.startsWith(gated + sep)) {
    return {};
  }
  try {
    return parseDotenv(readFileSync(resolved, 'utf-8'));
  } catch {
    return {};
  }
}

const secretKeyNames: string[] = [];
let loadedFrom: string | undefined;

/**
 * Loads `<HOME>/<data-dir>/secrets/.env` into `process.env` (secrets win over
 * inherited values) so every process that reads env gets the keys, while ad-hoc
 * Bash spawned by Claude never does. Failure-tolerant — never throws. An absent
 * file is the normal case (homes without secrets / pre-migration).
 *
 * Keyed on the resolved file, not a boolean: a plain "already ran" latch made the
 * FIRST import decide which home's secrets the process uses forever, so anything
 * that set `AGENT_HOME` afterwards silently got the wrong store (or none) and the
 * per-read calls below could never correct it. Re-keying makes loading genuinely
 * order-independent, which is what every caller here already assumes.
 *
 * Switching homes drops the keys the previous store injected, so its values can't
 * leak into the new one. Only keys this function set are removed — but note that a
 * same-named value inherited from the shell was already overwritten, so it does not
 * come back. Homes don't change mid-process outside tests.
 */
export function loadSecretsEnv(): void {
  const file = secretsEnvFile();
  if (loadedFrom === file) return;
  for (const key of secretKeyNames) {
    delete process.env[key];
  }
  secretKeyNames.length = 0;
  loadedFrom = file;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseDotenv(raw))) {
    process.env[key] = value;
    secretKeyNames.push(key);
  }
}

loadSecretsEnv();

/**
 * Read one environment value through the gate. Trimmed, or `undefined` when
 * unset/blank. An `AGENT_*` key's per-agent override (e.g. `KEVIN_*`) wins
 * over the shared name.
 */
export const env = (key: string): string | undefined => {
  loadSecretsEnv();
  return overrideValue(key) || process.env[key]?.trim() || undefined;
};

/** Names of the keys loaded from `secrets/.env` (values never leave this module). */
export const loadedSecretKeyNames = (): readonly string[] => {
  loadSecretsEnv();
  return secretKeyNames;
};

const DB_ENV_PREFIX = 'AGENT_DB_';

export interface DbConnection {
  name: string;
  envKey: string;
}

/**
 * Every `AGENT_DB_<NAME>` connection configured in `secrets/.env` — the
 * per-agent spelling (e.g. `KEVIN_DB_<NAME>`) also discovered — name
 * lowercased. When both spellings define one name, the per-agent one wins.
 */
export const dbConnections = (): DbConnection[] => {
  loadSecretsEnv();
  const prefix = agentEnvPrefix();
  const prefixes = prefix ? [DB_ENV_PREFIX, `${prefix}DB_`] : [DB_ENV_PREFIX];
  const byName = new Map<string, string>();
  for (const dbPrefix of prefixes) {
    Object.keys(process.env)
      .filter((key) => key.startsWith(dbPrefix) && key.length > dbPrefix.length && process.env[key]?.trim())
      .forEach((envKey) => byName.set(envKey.slice(dbPrefix.length).toLowerCase(), envKey));
  }
  return [...byName.entries()]
    .map(([name, envKey]) => ({ name, envKey }))
    .sort((first, second) => first.name.localeCompare(second.name));
};

/**
 * Resolve a free-form connection name to its configured env key — the
 * per-agent spelling (e.g. `KEVIN_DB_<NAME>`) when set, else the shared
 * `AGENT_DB_<NAME>`.
 */
export const dbEnvKeyFor = (name: string): string => {
  loadSecretsEnv();
  const suffix = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const prefix = agentEnvPrefix();
  const overrideKey = prefix ? `${prefix}DB_${suffix}` : undefined;
  return overrideKey && process.env[overrideKey]?.trim() ? overrideKey : DB_ENV_PREFIX + suffix;
};

/**
 * Exact-match redaction. Replaces every value in `secrets/.env` (≥12 chars, to
 * avoid scrubbing short common strings) with `<REDACTED:KEY_NAME>`. Read and
 * matched here so callers (the session-capture redactor) scrub text without ever
 * holding a raw secret value. `settings.local.json` is NOT scrubbed: by design
 * it holds only private, non-secret config.
 */
export function scrubValues(text: string): string {
  let secrets: Record<string, string>;
  try {
    secrets = parseDotenv(readFileSync(secretsEnvFile(), 'utf-8'));
  } catch {
    return text; // no/unreadable secrets/.env — prefix heuristics in the caller still run
  }
  let out = text;
  for (const [name, value] of Object.entries(secrets)) {
    if (value.length < 12) continue;
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), `<REDACTED:${name}>`);
  }
  return out;
}
