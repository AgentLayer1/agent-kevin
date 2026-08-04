import { log } from '@/shared/log';
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
 * Env naming: the plugin's own vars use the agent-neutral `AGENT_` prefix so a
 * fork never rename-sweeps them. The legacy `KEVIN_` spellings are honored for
 * one release window (reads warn once per key). When adding a var, avoid names
 * CI systems inject — Azure Pipelines sets `AGENT_OS`, `AGENT_NAME`,
 * `AGENT_HOMEDIRECTORY`, and friends on every build agent.
 *
 * Robustness: `env()` triggers `loadSecretsEnv()` first, and that load is keyed on
 * the resolved secrets file, so secrets are populated from the CURRENT home no
 * matter who imported what, in what order. There is no import-order discipline to
 * forget.
 */

/**
 * Folder name of the agent's runtime data dir — THE single place it's defined.
 * `.kevin` today; a future rename (or a conflict escape via the
 * `AGENT_RUNTIME_DIR` override — a bare folder name, not a path) happens here.
 * Read raw from `process.env`: the secrets loader itself resolves through this,
 * so it cannot go through `env()`. `shared/log.ts` mirrors this read inline to
 * stay dependency-free.
 */
export const RUNTIME_DIR_DEFAULT = '.kevin';
export const runtimeDirName = (): string => process.env.AGENT_RUNTIME_DIR?.trim() || RUNTIME_DIR_DEFAULT;

/** Legacy `KEVIN_*` spelling of a neutral `AGENT_*` key, or undefined for keys with no legacy form. */
const legacyKeyFor = (key: string): string | undefined =>
  key.startsWith('AGENT_') ? `KEVIN_${key.slice('AGENT_'.length)}` : undefined;

const warnedLegacyKeys = new Set<string>();

/** Read a legacy key directly off `process.env`, warning once per key so operators migrate. */
const readLegacy = (legacy: string, replacement: string): string | undefined => {
  const value = process.env[legacy]?.trim() || undefined;
  if (value && !warnedLegacyKeys.has(legacy)) {
    warnedLegacyKeys.add(legacy);
    log.warn(`${legacy} is deprecated — rename it to ${replacement}`);
  }
  return value;
};

/**
 * Resolve the agent HOME: `AGENT_HOME` (or its legacy `KEVIN_HOME` spelling)
 * when set, else the nearest ancestor of cwd (cwd included) carrying this
 * agent's data dir (`runtimeDirName()`, created at init). A bare cwd fallback
 * anchors to wherever the process happened to launch; for a session launched
 * inside a code repo that puts session captures, data-dir state, and logs
 * INSIDE the repo, so the walk-up refuses to anchor on anything that isn't
 * this agent's scaffolded home. The data dir (not SOUL.md) is the marker
 * because it's agent-specific: every sibling agent's home carries a SOUL.md,
 * but only this agent's carries the data dir, so the walk can never anchor on
 * another agent's brain. Falls back to cwd only when no home exists on the
 * ancestor path (the pre-init case). A derived home is written back to
 * `process.env.AGENT_HOME` so the dependency-free logger and child processes
 * inherit it; the cwd fallback is never written back.
 */
export function agentHomePath(): string {
  const fromVar = process.env.AGENT_HOME?.trim() || readLegacy('KEVIN_HOME', 'AGENT_HOME');
  if (fromVar) {
    return expandTilde(fromVar);
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
 * unset/blank. An `AGENT_*` key falls back to its legacy `KEVIN_*` spelling.
 */
export const env = (key: string): string | undefined => {
  loadSecretsEnv();
  const direct = process.env[key]?.trim();
  if (direct) return direct;
  const legacy = legacyKeyFor(key);
  return legacy ? readLegacy(legacy, key) : undefined;
};

/** Names of the keys loaded from `secrets/.env` (values never leave this module). */
export const loadedSecretKeyNames = (): readonly string[] => {
  loadSecretsEnv();
  return secretKeyNames;
};

const DB_ENV_PREFIX = 'AGENT_DB_';
const LEGACY_DB_ENV_PREFIX = 'KEVIN_DB_';

export interface DbConnection {
  name: string;
  envKey: string;
}

/**
 * Every `AGENT_DB_<NAME>` connection configured in `secrets/.env` (legacy
 * `KEVIN_DB_<NAME>` still discovered), name lowercased. When both spellings
 * define one name, the `AGENT_DB_` one wins.
 */
export const dbConnections = (): DbConnection[] => {
  loadSecretsEnv();
  const byName = new Map<string, string>();
  for (const prefix of [LEGACY_DB_ENV_PREFIX, DB_ENV_PREFIX]) {
    Object.keys(process.env)
      .filter((key) => key.startsWith(prefix) && key.length > prefix.length && process.env[key]?.trim())
      .forEach((envKey) => byName.set(envKey.slice(prefix.length).toLowerCase(), envKey));
  }
  return [...byName.entries()]
    .map(([name, envKey]) => ({ name, envKey }))
    .sort((first, second) => first.name.localeCompare(second.name));
};

/**
 * Resolve a free-form connection name to its configured env key —
 * `AGENT_DB_<NAME>` when set (and when neither spelling is), else the legacy
 * `KEVIN_DB_<NAME>` a pre-rename home still carries.
 */
export const dbEnvKeyFor = (name: string): string => {
  loadSecretsEnv();
  const suffix = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const preferred = DB_ENV_PREFIX + suffix;
  const legacy = LEGACY_DB_ENV_PREFIX + suffix;
  return !process.env[preferred]?.trim() && process.env[legacy]?.trim() ? legacy : preferred;
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
