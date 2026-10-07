#!/usr/bin/env bun
/**
 * Upgrade migration for v0.7.0: the data dir moves from the agent-named folder to the shared
 * `.state`, which only a `version.json` recording this plugin can claim.
 *
 * Order is the safety argument: validate, stamp the record, then point the protections at `.state`
 * before anything lands there (the secrets deny rules and the `.gitignore` that keeps the store out
 * of history; both additive), move the folder in one rename, and repoint the home's `.mcp.json`
 * servers that read the old secrets file. A failure before the move leaves only those additions; a
 * failure after it is finished by re-running. Every file it rewrites is backed up under
 * `<data dir>/updates/` first.
 *
 * Run by `/agent-kevin:upgrade` via `run_upgrade` (outside the Bash sandbox, which denies writes to
 * `.claude/settings.json`). Idempotent.
 * Contract: prints a single-line JSON report as its LAST stdout line; exits non-zero on failure.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { reconcileHomeGitignore } from '../../../mcp-server/src/home/gitignore';
import {
  LEGACY_RUNTIME_DIR,
  RUNTIME_DIR,
  isOwnDataDir,
  pluginName,
  resolveEnv
} from '../../../mcp-server/src/shared/naming';

const VERSION = '0.7.0';

const HOME = resolve(resolveEnv('AGENT_HOME') ?? process.cwd());
const LEGACY = resolve(HOME, LEGACY_RUNTIME_DIR);
const TARGET = resolve(HOME, RUNTIME_DIR);
const PLUGIN = pluginName();
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const TEMPLATE_GITIGNORE = resolve(import.meta.dir, '..', '..', '..', 'templates', '.gitignore');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const backup = (dataDir: string, file: string): void => {
  const dir = resolve(dataDir, 'updates', `${VERSION}-${STAMP}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(file, resolve(dir, basename(file)));
};

const writeAtomic = (file: string, text: string): void => {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
};

/** Make the legacy dir's version.json record this plugin, so `.state` is claimable after the move. */
const stampLegacy = (): 'current' | 'stamped' | 'created' => {
  const file = resolve(LEGACY, 'version.json');
  if (!existsSync(file)) {
    writeAtomic(file, `${JSON.stringify({ plugin: PLUGIN }, null, 2)}\n`);
    return 'created';
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    throw new Error(`${file} does not parse; restore it from the brain repo, then re-run the upgrade`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${file} is not a JSON object; restore it from the brain repo, then re-run the upgrade`);
  }
  if (parsed.plugin === PLUGIN) {
    return 'current';
  }
  backup(LEGACY, file);
  const stamped = Object.fromEntries([
    ['plugin', PLUGIN],
    ...Object.entries(parsed).filter(([key]) => key !== 'plugin')
  ]);
  writeAtomic(file, `${JSON.stringify(stamped, null, 2)}\n`);
  return 'stamped';
};

const STATE_SECRETS = `${RUNTIME_DIR}/secrets`;

/** The object at `parent[key]`, created when absent, so a rule can be added under it. */
const objectAt = (parent: Record<string, unknown>, key: string): Record<string, unknown> => {
  const existing = parent[key];
  const child = isRecord(existing) ? existing : {};
  parent[key] = child;
  return child;
};

/**
 * Adds the three rules init writes to keep the secrets store unreadable, pointed at `.state`, to the
 * home's own settings. They go here whatever protected the legacy store (user-level settings name it,
 * not `.state`); the legacy rules stay until the sunset release.
 */
const ensureStateDenies = (dataDir: string): string[] => {
  const file = resolve(HOME, '.claude', 'settings.json');
  const settings: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {};
  if (!isRecord(settings)) {
    throw new Error(`${file} is not a JSON object`);
  }
  const sandbox = objectAt(settings, 'sandbox');
  const rules = [
    { at: objectAt(settings, 'permissions'), key: 'deny', rule: `Read(//**/${STATE_SECRETS}/**)` },
    { at: objectAt(sandbox, 'filesystem'), key: 'denyRead', rule: STATE_SECRETS },
    { at: objectAt(sandbox, 'credentials'), key: 'files', rule: { path: STATE_SECRETS, mode: 'deny' } }
  ];
  const listOf = (at: Record<string, unknown>, key: string): unknown[] => {
    const list = at[key];
    return Array.isArray(list) ? list : [];
  };
  const missing = rules.filter(
    ({ at, key, rule }) => !listOf(at, key).some((entry) => JSON.stringify(entry) === JSON.stringify(rule))
  );
  if (missing.length === 0) {
    return [];
  }
  if (existsSync(file)) {
    backup(dataDir, file);
  }
  missing.forEach(({ at, key, rule }) => {
    at[key] = [...listOf(at, key), rule];
  });
  mkdirSync(resolve(HOME, '.claude'), { recursive: true });
  writeAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
  return missing.map(({ key, rule }) => `${key}: ${JSON.stringify(rule)}`);
};

/** Re-points `.mcp.json` servers that source the legacy secrets file, in any path form; the text is edited in place. */
const repointMcp = (): boolean => {
  const file = resolve(HOME, '.mcp.json');
  const legacySecrets = `${LEGACY_RUNTIME_DIR}/secrets/`;
  if (!existsSync(file) || !readFileSync(file, 'utf-8').includes(legacySecrets)) {
    return false;
  }
  const updated = readFileSync(file, 'utf-8').split(legacySecrets).join(`${STATE_SECRETS}/`);
  JSON.parse(updated);
  backup(TARGET, file);
  writeAtomic(file, updated);
  return true;
};

/** Everything that must point at `.state` around the move; idempotent, so a re-run finishes a failed one. */
const prepare = (dataDir: string) => ({
  denies: ensureStateDenies(dataDir),
  gitignore: reconcileHomeGitignore(HOME, TEMPLATE_GITIGNORE, true).added
});

const migrate = () => {
  if (isOwnDataDir(TARGET)) {
    const leftover = existsSync(LEGACY);
    return {
      action: 'already-moved',
      stamp: 'current',
      ...prepare(TARGET),
      mcp: repointMcp(),
      ...(leftover ? { warning: `${LEGACY} exists again beside ${TARGET}; an older session wrote to it` } : {})
    };
  }
  if (existsSync(TARGET)) {
    throw new Error(
      `${TARGET} already exists and does not record ${PLUGIN} in its version.json, so it is not this agent's to move onto. ` +
        `If you created it by hand before upgrading (a secrets key, say), move what you put there into ${LEGACY}; ` +
        `then move ${TARGET} aside (nothing in it is touched) and re-run the upgrade`
    );
  }
  if (!existsSync(LEGACY)) {
    return { action: 'no-data-dir' };
  }
  if (!isOwnDataDir(LEGACY)) {
    throw new Error(
      `${LEGACY} is not ${PLUGIN}'s data dir (no home marker, or its version.json records another plugin); nothing was moved`
    );
  }
  const stamp = stampLegacy();
  const prepared = prepare(LEGACY);
  try {
    renameSync(LEGACY, TARGET);
  } catch (err) {
    // Windows refuses to rename a folder while anything holds a file open inside it.
    throw new Error(
      `Could not move ${LEGACY} to ${TARGET} (${err instanceof Error ? err.message : String(err)}); nothing was moved. ` +
        `Close other sessions of this agent and any app with a file open in it (an editor, a sync client), then re-run the upgrade`
    );
  }
  return { action: 'moved', stamp, ...prepared, mcp: repointMcp() };
};

try {
  process.stdout.write(JSON.stringify({ ok: true, version: VERSION, home: HOME, ...migrate() }) + '\n');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, version: VERSION, error: message }) + '\n');
  process.exit(1);
}
