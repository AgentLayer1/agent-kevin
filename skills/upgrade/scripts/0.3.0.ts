#!/usr/bin/env bun
/**
 * Upgrade migration for v0.3.0 — centralize secrets into `.kevin/secrets/`.
 *
 * Moves credential env vars out of `.claude/settings.local.json` and Google
 * OAuth files out of `.kevin/config/` into the deny-gated `.kevin/secrets/`,
 * then writes the Read denies. Run by `/agent-kevin:upgrade` via the
 * `run_upgrade` MCP tool (outside the Bash sandbox, so it can touch the
 * deny-gated paths). Self-contained, idempotent, fail-loud.
 *
 * Contract: prints a single-line JSON report as its LAST stdout line; exits
 * non-zero (without stripping anything) if the round-trip verify fails.
 *
 * Convention: a heavy/required migration lives at `skills/upgrade/scripts/<version>.ts`,
 * where `<version>` is the **target release it is applied when upgrading to** (this
 * file ships in v0.3.0, so it is `0.3.0.ts`). The runtime never carries this logic —
 * it's quarantined here and pruned once the minimum supported baseline passes it.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOME = process.env.KEVIN_HOME?.trim() || process.cwd();
const isWindows = process.platform === 'win32';

const SETTINGS_LOCAL = resolve(HOME, '.claude', 'settings.local.json');
const SETTINGS_PROJECT = resolve(HOME, '.claude', 'settings.json');
const OLD_CONFIG_DIR = resolve(HOME, '.kevin', 'config');
const UPDATES_DIR = resolve(HOME, '.kevin', 'updates');
const SECRETS_DIR = resolve(HOME, '.kevin', 'secrets');
const SECRETS_ENV = resolve(SECRETS_DIR, '.env');
const GOOGLE_DIR = resolve(SECRETS_DIR, 'google');

const SECRET_KEYS = ['PERPLEXITY_API_KEY', 'SERPAPI_KEY', 'OPENPAGERANK_API_KEY'];
const SECRET_PREFIXES = ['KEVIN_DB_'];
const GOOGLE_FILES = ['google-oauth-client.json', 'google-tokens.json'];
// Read-tool deny uses gitignore matching, where `**` will NOT descend into a dot-dir
// like `.kevin` — so the secrets deny must be absolute-anchored (`//`) to bite. The
// sandbox (Bash) matcher takes a project-root-relative path, sidestepping it entirely.
const SECRETS_READ_DENY = 'Read(//**/.kevin/secrets/**)';
const SECRETS_SANDBOX_GLOB = '.kevin/secrets/**';
const DENY_GLOBS = [SECRETS_READ_DENY];

const isSecretKey = (key: string): boolean =>
  SECRET_KEYS.includes(key) || SECRET_PREFIXES.some((prefix) => key.startsWith(prefix));

function parseDotenv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const serializeDotenv = (entries: Record<string, string>): string =>
  Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';

const readJson = (path: string): Record<string, unknown> =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>) : {};

const chmodSafe = (path: string, mode: number): void => {
  if (!isWindows) chmodSync(path, mode);
};

/**
 * Sweep the upgrade skill's pre-strip backups. Step 3 of `/agent-kevin:upgrade`
 * snapshots touched HOME files into `.kevin/updates/` (which nothing deny-gates)
 * BEFORE this script runs in Step 4 — so on this one transition it captures a
 * `settings.local.json` that still holds the secrets we're centralizing. Delete any
 * such copy. Self-limiting: post-migration `settings.local.json` carries no secret
 * keys, so future skill backups never match. Idempotent and failure-tolerant.
 */
function purgeLeakedSettingsBackups(): string[] {
  if (!existsSync(UPDATES_DIR)) return [];
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(UPDATES_DIR, { recursive: true }) as string[];
  } catch {
    return removed;
  }
  for (const rel of entries) {
    if (!rel.endsWith('settings.local.json')) continue;
    const path = resolve(UPDATES_DIR, rel);
    try {
      const json = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
      const env = (json.env && typeof json.env === 'object' ? json.env : {}) as Record<string, unknown>;
      if (Object.keys(env).some(isSecretKey)) {
        rmSync(path);
        removed.push(path);
      }
    } catch {
      continue; // unreadable / not JSON — leave it untouched
    }
  }
  return removed;
}

function main(): void {
  const manualNotes: string[] = [];

  mkdirSync(SECRETS_DIR, { recursive: true });
  chmodSafe(SECRETS_DIR, 0o700);
  mkdirSync(GOOGLE_DIR, { recursive: true });
  chmodSafe(GOOGLE_DIR, 0o700);

  // ── 1. Merge secret keys from settings env into secrets/.env (secrets win) ──
  const settings = readJson(SETTINGS_LOCAL);
  const env = (settings.env && typeof settings.env === 'object' ? settings.env : {}) as Record<string, string>;
  const secrets = existsSync(SECRETS_ENV) ? parseDotenv(readFileSync(SECRETS_ENV, 'utf-8')) : {};

  const detected = Object.keys(env).filter(isSecretKey);
  const moved: string[] = [];
  const skipped: string[] = [];
  for (const key of detected) {
    if (key in secrets) {
      skipped.push(key); // already centralized — never clobber the secrets copy
    } else {
      secrets[key] = env[key];
      moved.push(key);
    }
  }
  if (moved.length > 0 || !existsSync(SECRETS_ENV)) {
    writeFileSync(SECRETS_ENV, serializeDotenv(secrets));
  }
  chmodSafe(SECRETS_ENV, 0o600);

  // ── 2. Move Google OAuth files config/ → secrets/google/ ────────────────────
  const googleMoved: string[] = [];
  for (const file of GOOGLE_FILES) {
    const src = resolve(OLD_CONFIG_DIR, file);
    const dest = resolve(GOOGLE_DIR, file);
    if (existsSync(src) && !existsSync(dest)) {
      renameSync(src, dest);
      chmodSafe(dest, 0o600);
      googleMoved.push(file);
    }
  }

  // ── 3. Verify round-trip BEFORE deleting anything ───────────────────────────
  const verifySecrets = existsSync(SECRETS_ENV) ? parseDotenv(readFileSync(SECRETS_ENV, 'utf-8')) : {};
  for (const key of detected) {
    // Every detected key is in `secrets` by now (moved or already-present).
    if (verifySecrets[key] !== secrets[key]) {
      throw new Error(`Verify failed: ${key} did not round-trip to secrets/.env — settings left untouched.`);
    }
  }
  for (const file of googleMoved) {
    if (!existsSync(resolve(GOOGLE_DIR, file))) {
      throw new Error(`Verify failed: ${file} missing at destination — settings left untouched.`);
    }
  }

  // ── 4. Strip the moved secret keys from settings.local.json ─────────────────
  // No pre-strip backup needed: Step 3 verified every secret round-tripped to
  // secrets/.env, so the values are already safely persisted there before we delete.
  let settingsStripped = false;
  if (existsSync(SETTINGS_LOCAL) && detected.length > 0) {
    for (const key of detected) delete env[key];
    settings.env = env;
    writeFileSync(SETTINGS_LOCAL, JSON.stringify(settings, null, 2) + '\n');
    settingsStripped = true;
  }

  // ── 4b. Purge the upgrade skill's pre-strip settings.local.json backup ──────
  const leakedBackupsRemoved = purgeLeakedSettingsBackups();

  // ── 5. Write both deny layers into HOME .claude/settings.json (union, dedupe) ──
  // Layer 1 (Read tool): `permissions.deny`. Layer 2 (Bash cat/grep): the OS sandbox
  // `filesystem.read.denyOnly`. BOTH are needed, and existing users never re-run /init,
  // so the migration must write both here. The sandbox merge is additive — it ensures
  // the nested arrays exist and adds the glob; it never enables the sandbox or touches
  // network/write rules. (Sandbox is unavailable on Windows, where the entry is dormant.)
  const project = readJson(SETTINGS_PROJECT);

  const permissions = (
    project.permissions && typeof project.permissions === 'object' ? project.permissions : {}
  ) as Record<string, unknown>;
  const deny = Array.isArray(permissions.deny) ? (permissions.deny as string[]) : [];
  const denyAdded = DENY_GLOBS.filter((glob) => !deny.includes(glob));

  const sandbox = (project.sandbox && typeof project.sandbox === 'object' ? project.sandbox : {}) as Record<
    string,
    unknown
  >;
  const filesystem = (sandbox.filesystem && typeof sandbox.filesystem === 'object' ? sandbox.filesystem : {}) as Record<
    string,
    unknown
  >;
  const read = (filesystem.read && typeof filesystem.read === 'object' ? filesystem.read : {}) as Record<
    string,
    unknown
  >;
  const denyOnly = Array.isArray(read.denyOnly) ? (read.denyOnly as string[]) : [];
  const sandboxDenyAdded = !denyOnly.includes(SECRETS_SANDBOX_GLOB);

  if (denyAdded.length > 0 || sandboxDenyAdded) {
    permissions.deny = [...deny, ...denyAdded];
    project.permissions = permissions;
    read.denyOnly = sandboxDenyAdded ? [...denyOnly, SECRETS_SANDBOX_GLOB] : denyOnly;
    filesystem.read = read;
    sandbox.filesystem = filesystem;
    project.sandbox = sandbox;
    writeFileSync(SETTINGS_PROJECT, JSON.stringify(project, null, 2) + '\n');
  }

  if (isWindows) {
    manualNotes.push(
      'Windows: file permissions (0600/0700) were NOT applied and the OS sandbox is unavailable — secrets/ is protected only by the Read-tool deny. TODO(windows).'
    );
  }

  const report = {
    ok: true,
    version: '0.3.0',
    moved,
    skipped,
    googleMoved,
    settingsStripped,
    leakedBackupsRemoved,
    denyAdded,
    sandboxDenyAdded,
    manualNotes,
    restart: 'Restart/reload Claude Code so the MCP server reloads with secrets/.env.'
  };
  process.stdout.write(JSON.stringify(report) + '\n');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: '0.3.0', error: message }) + '\n');
  process.exit(1);
}
