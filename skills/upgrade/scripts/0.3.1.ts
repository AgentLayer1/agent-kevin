#!/usr/bin/env bun
/**
 * Upgrade migration for v0.3.1 — complete the secret-file deny baseline.
 *
 * v0.3.0 shipped the broadened permissions.deny baseline (the dotenv / cert /
 * credential globs plus the two "curl pipe-to-shell" Bash denies) into /init, but
 * its migration wrote only the secrets-dir Read deny to existing homes — so homes
 * upgraded via the contract (not a fresh init) were left with the narrow deny.
 * This tops the project settings.json up to the full /init baseline. Idempotent.
 *
 * Two layers, matching /init exactly (the glob strings live in the constants below):
 *   - permissions.deny (Read tool plus curl-pipe-shell): the broad set.
 *   - sandbox.filesystem.read.denyOnly (blocks Bash cat/grep): the narrow set —
 *     the local secret stores only, never the broad cert/credential globs.
 *
 * Contract: prints a single-line JSON report as its LAST stdout line; exits
 * non-zero on failure. Self-contained, idempotent, fail-loud.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOME = process.env.KEVIN_HOME?.trim() || process.cwd();
const SETTINGS_PROJECT = resolve(HOME, '.claude', 'settings.json');

// The secrets deny needs the `//` absolute anchor: gitignore-style `**` won't descend
// into the `.kevin` dot-dir, so a bare `**/.kevin/secrets/**` never matches. The sandbox
// (Bash) layer takes a project-root-relative path, which sidesteps the dot-dir entirely.
const SECRETS_READ_DENY = 'Read(//**/.kevin/secrets/**)';
const READ_DENY_GLOBS = ['**/.env', '**/.env.*', '**/secrets/**', '**/credentials/**', '**/*.pem', '**/*.key'];
const BASH_DENY_RULES = ['Bash(curl *|sh*)', 'Bash(curl *| sh*)'];
const PERM_DENY_RULES = [SECRETS_READ_DENY, ...READ_DENY_GLOBS.map((glob) => `Read(${glob})`), ...BASH_DENY_RULES];
const SANDBOX_DENY_GLOBS = ['.kevin/secrets/**', '**/.env', '**/.env.*'];

const readJson = (path: string): Record<string, unknown> =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>) : {};

function main(): void {
  const project = readJson(SETTINGS_PROJECT);

  const permissions = (
    project.permissions && typeof project.permissions === 'object' ? project.permissions : {}
  ) as Record<string, unknown>;
  const deny = Array.isArray(permissions.deny) ? (permissions.deny as string[]) : [];
  const denyAdded = PERM_DENY_RULES.filter((rule) => !deny.includes(rule));

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
  const sandboxDenyAdded = SANDBOX_DENY_GLOBS.filter((glob) => !denyOnly.includes(glob));

  if (denyAdded.length > 0 || sandboxDenyAdded.length > 0) {
    permissions.deny = [...deny, ...denyAdded];
    project.permissions = permissions;
    read.denyOnly = [...denyOnly, ...sandboxDenyAdded];
    filesystem.read = read;
    sandbox.filesystem = filesystem;
    project.sandbox = sandbox;
    writeFileSync(SETTINGS_PROJECT, JSON.stringify(project, null, 2) + '\n');
  }

  const report = {
    ok: true,
    version: '0.3.1',
    denyAdded,
    sandboxDenyAdded,
    settingsTouched: denyAdded.length > 0 || sandboxDenyAdded.length > 0
  };
  process.stdout.write(JSON.stringify(report) + '\n');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: '0.3.1', error: message }) + '\n');
  process.exit(1);
}
