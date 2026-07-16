import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';

/**
 * The ONE place the codebase reads `process.env`.
 *
 * Convention: a literal `process.env.<X>` / `process.env[x]` appears nowhere
 * else. The sole other exception is `shared/log.ts` — a self-contained logger
 * that must stay dependency-free. Everything else reads through `env()` (or a
 * helper here). A guard test enforces this — see `config.env-convention.test.ts`.
 *
 * Why this lives apart from `config.ts`: config resolves its FOLDERS layout once
 * at import (a frozen singleton), so importing it early in the shared test
 * process clobbers pipeline.test.ts's per-HOME isolation. This module is
 * config-free and resolves the secrets dir lazily from KEVIN_HOME at read time,
 * so tools (and their tests) can read env without dragging that singleton in.
 *
 * Robustness: `env()` triggers `loadSecretsEnv()` first, so secrets are
 * populated before any read no matter who imported what, in what order. There is
 * no "import config first" discipline to forget.
 */

const tildify = (path: string): string => (path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path);

/** `<HOME>/.kevin/secrets/.env`, resolved live (never frozen) so a test that sets KEVIN_HOME is honoured. */
const secretsEnvFile = (): string => {
  const home = tildify(process.env.KEVIN_HOME?.trim() || process.cwd());
  return resolve(home, '.kevin', 'secrets', '.env');
};

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

/** `<HOME>/.kevin/secrets` — the deny-gated store holding the agent's own secrets. */
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
 * (`<HOME>/.kevin/secrets/`). That dir holds Kevin's operational keys (GitHub,
 * Google, DB URLs); a flow-scoped loader must not be a path back into it. Any
 * path resolving inside the secrets dir returns `{}` — those secrets flow only
 * through `env()`, never this seam.
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
let secretsLoaded = false;

/**
 * Loads `<HOME>/.kevin/secrets/.env` into `process.env` (secrets win over
 * inherited values) so every process that reads env gets the keys, while ad-hoc
 * Bash spawned by Claude never does. Idempotent and failure-tolerant — runs once
 * per process, never throws. An absent file is the normal case (homes without
 * secrets / pre-migration).
 */
export function loadSecretsEnv(): void {
  if (secretsLoaded) return;
  secretsLoaded = true;
  let raw: string;
  try {
    raw = readFileSync(secretsEnvFile(), 'utf-8');
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseDotenv(raw))) {
    process.env[key] = value;
    secretKeyNames.push(key);
  }
}

loadSecretsEnv();

/** Read one environment value through the gate. Trimmed, or `undefined` when unset/blank. */
export const env = (key: string): string | undefined => {
  loadSecretsEnv();
  return process.env[key]?.trim() || undefined;
};

/** Names of the keys loaded from `secrets/.env` (values never leave this module). */
export const loadedSecretKeyNames = (): readonly string[] => {
  loadSecretsEnv();
  return secretKeyNames;
};

const DB_ENV_PREFIX = 'KEVIN_DB_';

export interface DbConnection {
  name: string;
  envKey: string;
}

/** Every `KEVIN_DB_<NAME>` connection configured in `secrets/.env`, name lowercased. */
export const dbConnections = (): DbConnection[] => {
  loadSecretsEnv();
  return Object.keys(process.env)
    .filter((key) => key.startsWith(DB_ENV_PREFIX) && key.length > DB_ENV_PREFIX.length && process.env[key]?.trim())
    .map((envKey) => ({ name: envKey.slice(DB_ENV_PREFIX.length).toLowerCase(), envKey }))
    .sort((first, second) => first.name.localeCompare(second.name));
};

/** Resolve a free-form connection name to its `KEVIN_DB_<NAME>` env key. */
export const dbEnvKeyFor = (name: string): string => DB_ENV_PREFIX + name.toUpperCase().replace(/[^A-Z0-9]/g, '_');

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
