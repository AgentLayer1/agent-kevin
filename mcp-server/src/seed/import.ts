/**
 * seed_import — overlay a seed bundle onto THIS (already-initialized) home.
 *
 * Fork semantics: written files become the recipient's own, freely editable.
 * The projection is containment-first — every payload path is validated
 * against the format's allowed roots and resolved inside the home before a
 * single byte lands, so a hostile manifest can't touch settings, secrets,
 * `.kevin/` state, or anything else. Payload hashes are verified (a corrupt
 * or tampered bundle fails loud, never half-applies).
 *
 * Beyond files, the manifest's setup fields are merged, never clobbered:
 * permission entries dedupe into settings.json, MCP servers land in .mcp.json
 * only under names not already taken, non-secret env keys are planted empty in
 * settings.local.json, and secret key NAMES come back as a fill-this checklist
 * (the store is ensured to exist; its contents are never read or written).
 */
import { FOLDERS } from '@/config';
import { CREDENTIAL_KEY_RE, type SeedManifest, sha256, validateSeedPath } from '@/seed/format';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface SeedImportOptions {
  /** Absolute path to the seed bundle zip. */
  bundlePath: string;
  /** Overwrite existing files that differ from the bundle. Off by default — conflicts are reported, not written. */
  overwrite?: boolean;
  /** Report the full plan without writing anything. */
  dryRun?: boolean;
}

export interface SeedImportResult {
  agentName: string;
  dryRun: boolean;
  written: string[];
  /** Existing files that differ from the bundle and were left untouched (re-run with overwrite after review). */
  conflicts: string[];
  /** Files whose local copy already matches the bundle. */
  unchanged: string[];
  /** CLAUDE.local.md when the overlay was appended to an existing file rather than written fresh. */
  appended: string[];
  permissionsAdded: { allow: string[]; ask: string[] };
  mcpServersAdded: string[];
  /** MCP server names already present locally — never clobbered. */
  mcpServersSkipped: string[];
  settingsEnvPlanted: string[];
  /** Secret key NAMES the operator must fill in `.kevin/secrets/.env` via their editor. */
  secretKeysToFill: string[];
}

const readJson = (path: string): Record<string, unknown> =>
  existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>) : {};

const writeJson = (path: string, value: Record<string, unknown>): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const unzip = (bundlePath: string, destination: string): void => {
  try {
    execFileSync('unzip', ['-q', bundlePath, '-d', destination], { stdio: 'ignore' });
  } catch (cause) {
    throw new Error(`could not unzip seed bundle at ${bundlePath} — is it a valid zip?`, { cause });
  }
};

const parseManifest = (stagingDir: string): SeedManifest => {
  const manifestPath = join(stagingDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('seed bundle has no manifest.json at its root');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as SeedManifest;
  if (manifest.formatVersion !== 1) {
    throw new Error(`unsupported seed formatVersion ${String(manifest.formatVersion)} (this plugin reads 1)`);
  }
  if (typeof manifest.agentName !== 'string' || !Array.isArray(manifest.files)) {
    throw new Error('seed manifest is malformed: agentName (string) and files (array) are required');
  }
  const errors = manifest.files
    .map((file) => validateSeedPath(file.path))
    .filter((error): error is string => error !== null);
  if (errors.length > 0) throw new Error(`seed import refused:\n${errors.join('\n')}`);
  return manifest;
};

export const importSeed = (options: SeedImportOptions): SeedImportResult => {
  const home = FOLDERS.HOME;
  const dryRun = options.dryRun ?? false;
  if (!existsSync(options.bundlePath)) throw new Error(`seed bundle not found: ${options.bundlePath}`);

  const staging = mkdtempSync(join(tmpdir(), 'seed-import-'));
  try {
    unzip(options.bundlePath, staging);
    const manifest = parseManifest(staging);

    // Verify payload integrity + containment for the whole set before any write.
    for (const file of manifest.files) {
      const source = join(staging, 'files', file.path);
      if (!existsSync(source)) throw new Error(`bundle is missing payload for manifest entry: ${file.path}`);
      // A zip can carry symlink entries; reading through one would pull a file off THIS
      // machine's disk into the flow. Only regular files are acceptable payload.
      if (!lstatSync(source).isFile()) throw new Error(`payload is not a regular file: ${file.path}`);
      const actual = sha256(readFileSync(source));
      if (actual !== file.hash) throw new Error(`hash mismatch for ${file.path} — bundle is corrupt or tampered`);
      const destination = resolve(home, file.path);
      if (destination !== home && !destination.startsWith(home + '/')) {
        throw new Error(`path escapes the home: ${file.path}`);
      }
    }

    const written: string[] = [];
    const conflicts: string[] = [];
    const unchanged: string[] = [];
    const appended: string[] = [];

    for (const file of manifest.files) {
      const source = join(staging, 'files', file.path);
      const destination = resolve(home, file.path);
      // The CLAUDE overlay composes with whatever the recipient's init wrote — append, never replace.
      if (file.path === 'CLAUDE.local.md' && existsSync(destination)) {
        if (!dryRun) appendFileSync(destination, `\n\n${readFileSync(source, 'utf-8')}`);
        appended.push(file.path);
        continue;
      }
      if (existsSync(destination)) {
        if (sha256(readFileSync(destination)) === file.hash) {
          unchanged.push(file.path);
          continue;
        }
        if (!options.overwrite) {
          conflicts.push(file.path);
          continue;
        }
      }
      if (!dryRun) {
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(source, destination);
      }
      written.push(file.path);
    }

    // Permissions merge — dedupe into settings.json, preserving everything else in the file.
    const settingsPath = resolve(home, '.claude', 'settings.json');
    const settings = readJson(settingsPath);
    const permissions = (settings.permissions ?? {}) as Record<string, string[]>;
    const mergeGrants = (list: 'allow' | 'ask'): string[] => {
      const incoming = manifest.permissions?.[list] ?? [];
      const current = permissions[list] ?? [];
      const added = incoming.filter((entry) => !current.includes(entry));
      if (added.length > 0) permissions[list] = [...current, ...added].sort();
      return added;
    };
    const permissionsAdded = { allow: mergeGrants('allow'), ask: mergeGrants('ask') };
    if (!dryRun && (permissionsAdded.allow.length > 0 || permissionsAdded.ask.length > 0)) {
      settings.permissions = permissions;
      writeJson(settingsPath, settings);
    }

    // MCP servers — merge into <HOME>/.mcp.json under names not already taken.
    const mcpPath = resolve(home, '.mcp.json');
    const mcpConfig = readJson(mcpPath);
    const servers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>;
    const mcpServersAdded: string[] = [];
    const mcpServersSkipped: string[] = [];
    for (const [name, entry] of Object.entries(manifest.mcpServers ?? {})) {
      if (name in servers) {
        mcpServersSkipped.push(name);
        continue;
      }
      servers[name] = entry;
      mcpServersAdded.push(name);
    }
    if (!dryRun && mcpServersAdded.length > 0) {
      mcpConfig.mcpServers = servers;
      writeJson(mcpPath, mcpConfig);
    }

    // Non-secret env placeholders → settings.local.json `env` (empty, operator fills).
    // A credential-shaped name here is a producer mistake — rerouted to the secrets
    // checklist instead of planting a placeholder that invites a secret into settings.
    const misroutedSecrets = (manifest.settingsEnv ?? []).filter((key) => CREDENTIAL_KEY_RE.test(key));
    const localPath = resolve(home, '.claude', 'settings.local.json');
    const local = readJson(localPath);
    const env = (local.env ?? {}) as Record<string, unknown>;
    const settingsEnvPlanted = (manifest.settingsEnv ?? []).filter(
      (key) => !CREDENTIAL_KEY_RE.test(key) && !(key in env)
    );
    if (settingsEnvPlanted.length > 0) {
      for (const key of settingsEnvPlanted) env[key] = '';
      if (!dryRun) {
        local.env = env;
        writeJson(localPath, local);
      }
    }

    // Secret keys: ensure the deny-gated store EXISTS (write-only op, contents never touched);
    // the values are the operator's to fill in their editor.
    const secretKeysToFill = [...new Set([...(manifest.secretKeys ?? []), ...misroutedSecrets])].sort();
    if (!dryRun && secretKeysToFill.length > 0) {
      mkdirSync(FOLDERS.SECRETS, { recursive: true });
      chmodSync(FOLDERS.SECRETS, 0o700);
      const envFile = join(FOLDERS.SECRETS, '.env');
      if (!existsSync(envFile)) writeFileSync(envFile, '');
      chmodSync(envFile, 0o600);
    }

    return {
      agentName: manifest.agentName,
      dryRun,
      written,
      conflicts,
      unchanged,
      appended,
      permissionsAdded,
      mcpServersAdded,
      mcpServersSkipped,
      settingsEnvPlanted,
      secretKeysToFill
    };
  } finally {
    // Best-effort: a cleanup failure on the temp staging dir must never mask the real result/error.
    try {
      rmSync(staging, { recursive: true, force: true });
    } catch {
      // leave the temp dir to the OS
    }
  }
};
