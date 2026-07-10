/**
 * Local database fork — clone any database on a LOCAL Postgres server into a
 * private copy via `CREATE DATABASE <fork> TEMPLATE <source>` (pure SQL — no
 * pg_dump/pg_restore binaries, no dump file, cross-platform, instant), and
 * optionally write a `.env.local` override pointing at the fork.
 *
 * Reach for it any time a piece of work needs heavy or destructive schema
 * changes you don't want against a shared/live DB — a git worktree, an
 * experiment, a risky migration. The original stays the default; the fork is the
 * scratch copy.
 *
 * Remote hosts are refused. This issues DDL (CREATE/DROP DATABASE), so it only
 * acts on a local server (localhost / 127.0.0.1 / ::1 / unix socket) — never a
 * remote/production one. The server is a `KEVIN_DB_<NAME>` connection (same
 * discovery as the read-only database_* tools; secrets live in `.kevin/secrets/.env`,
 * never here), defaulting to the first configured connection. DDL can't run in a
 * transaction, so it uses a dedicated autocommit client. Like setup_worktree it
 * runs outside the Bash sandbox, so it can reach local Postgres and write the env
 * file.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { dbConnections, env } from '@/shared/env';
import { defineTool, type ToolDef } from '@/shared/types';
import { assertDbName, decodeDbName, resolveConnectionString } from '@/tools/database';
import pg from 'pg';
import { z } from 'zod';

/**
 * Quote a database name for interpolation into DDL (CREATE/DROP DATABASE take
 * identifiers, not bind params). Doubling embedded quotes is the complete
 * escape rule for quoted identifiers, so any legal name is injection-safe.
 */
export const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** Hosts a write/DDL tool may act on. Empty host = unix-socket connection (local). */
const LOCAL_HOSTS = new Set(['', 'localhost', '127.0.0.1', '::1']);
export const isLocalHost = (host: string): boolean => LOCAL_HOSTS.has(host.replace(/^\[|\]$/g, ''));

/** Resolve a KEVIN_DB_<NAME> connection name (or the first configured one) to its string. */
const resolveConnection = (name?: string): { name: string; url: string } => {
  const connections = dbConnections();
  if (!connections.length) {
    throw new Error('No database connections configured. Add a KEVIN_DB_<NAME> env var to .kevin/secrets/.env.');
  }
  const chosen = name ? connections.find((connection) => connection.name === name.toLowerCase()) : connections[0];
  const url = chosen && env(chosen.envKey);
  if (!chosen || !url) {
    throw new Error(
      `Unknown database connection "${name}". Available: ${connections.map((connection) => connection.name).join(', ')}.`
    );
  }
  return { name: chosen.name, url };
};

/**
 * Every database pinned by a KEVIN_DB_<NAME> connection. These are real,
 * configured databases — never valid drop/fork targets, so a fork name that
 * matches one is refused. Defensive against clobbering a connection's DB.
 */
export const configuredDatabases = (): Set<string> => {
  const databases = new Set<string>();
  for (const { envKey } of dbConnections()) {
    const url = env(envKey);
    if (!url) {
      continue;
    }
    try {
      const database = decodeDbName(new URL(url).pathname.replace(/^\//, ''));
      if (database) {
        databases.add(database);
      }
    } catch {
      // Unparseable connection string — dbConnections still lists it, but
      // it pins no usable database name to protect.
    }
  }
  return databases;
};

/** Current branch at `cwd`, or null when it isn't a git repo. */
const branchOf = (cwd: string): string | null => {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
};

/** "feat/foo-bar" → "<source>_feat_foo_bar", clamped to Postgres's 63-char identifier limit. */
export const deriveForkName = (source: string, branch: string): string => {
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${source}_${slug || 'fork'}`.slice(0, 63);
};

// A fork repoints by writing a `.env.local` OVERRIDE next to the base env,
// rather than mutating the base file. The app's loader layers `.env.local` over
// `.env` (last wins), so the override is isolated and teardown is just removing
// the line (or the file). The base config is never touched.
const OVERRIDE_FILE = '.env.local';

/** Set or replace `<envVar>=<value>` in a dotenv body; append if absent. */
export const upsertEnvLine = (content: string, envVar: string, value: string): string => {
  const escaped = envVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = `${envVar}="${value}"`;
  const pattern = new RegExp(`^${escaped}=.*$`, 'm');
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  return content === '' ? `${line}\n` : `${content.replace(/\n?$/, '\n')}${line}\n`;
};

/** The current value of `<envVar>` in a dotenv body (quotes stripped), or null if unset. */
export const readEnvLine = (content: string, envVar: string): string | null => {
  const escaped = envVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^${escaped}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
};

/** Remove the `<envVar>=` line; returns null when nothing meaningful remains. */
export const removeEnvLine = (content: string, envVar: string): string | null => {
  const escaped = envVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = content.replace(new RegExp(`^${escaped}=.*\\n?`, 'm'), '');
  return stripped.trim() === '' ? null : stripped;
};

/**
 * Write the override line into `<dir>/.env.local`. If that var is already set there
 * (a value the developer put in by hand), leave it untouched unless `force`, and
 * report it so the caller can tell the user to point it at the fork themselves.
 */
const writeEnvOverride = (
  dir: string,
  envVar: string,
  value: string,
  force: boolean
): { path: string; written: boolean; existing: string | null } => {
  const path = join(dir, OVERRIDE_FILE);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const existing = readEnvLine(current, envVar);
  if (existing !== null && !force) {
    return { path, written: false, existing };
  }
  writeFileSync(path, upsertEnvLine(current, envVar, value));
  return { path, written: true, existing };
};

/** Remove the override line from `<dir>/.env.local`, deleting the file if nothing else remains. */
const clearEnvOverride = (dir: string, envVar: string): string | null => {
  const path = join(dir, OVERRIDE_FILE);
  if (!existsSync(path)) {
    return null;
  }
  const next = removeEnvLine(readFileSync(path, 'utf8'), envVar);
  if (next === null) {
    unlinkSync(path);
  } else {
    writeFileSync(path, next);
  }
  return path;
};

const dbExists = async (client: pg.Client, database: string): Promise<boolean> => {
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  return (result.rowCount ?? 0) > 0;
};

/** Drop other sessions on `database` (its own excluded) so it can be dropped or used as a template. */
const terminateSessions = (client: pg.Client, database: string): Promise<pg.QueryResult> =>
  client.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [database]
  );

export const tools: ToolDef[] = [
  defineTool({
    name: 'database_fork',
    description:
      "Fork (clone) a database on a LOCAL Postgres server so you can make heavy or destructive schema changes without touching the shared/live one — for a worktree, an experiment, or a risky migration. Clones via CREATE DATABASE ... TEMPLATE (pure SQL, no dump tools). With repointEnv:true it writes a `.env.local` override in `cwd` pointing at the fork (and removes it on drop) — the base `.env` is never touched, and an existing override is left as-is (reported, not overwritten) unless force:true. Remote hosts are refused. The server is a KEVIN_DB_<NAME> connection (defaults to the first configured); source DB defaults to the connection's database; fork name defaults to <source>_<git-branch> when `cwd` is a repo, else <source>_fork. drop:true tears the fork down. terminateSource:true disconnects live sessions on the source so the clone can proceed.",
    inputSchema: {
      connection: z
        .string()
        .optional()
        .describe('KEVIN_DB_<NAME> connection name (from database_list). Defaults to the first configured connection.'),
      source: z
        .string()
        .optional()
        .describe('Database to clone FROM. Defaults to the database pinned in the connection string.'),
      fork: z
        .string()
        .optional()
        .describe('Name for the fork. Defaults to "<source>_<git-branch>" when `cwd` is a repo, else "<source>_fork".'),
      cwd: z
        .string()
        .optional()
        .describe(
          'Absolute path to the worktree/repo dir — derives the default fork name from its git branch, and (with repointEnv) where the .env.local override is written.'
        ),
      repointEnv: z
        .boolean()
        .optional()
        .describe('Write a `.env.local` DB override in `cwd` pointing at the fork (removed on drop). Requires `cwd`.'),
      envVar: z.string().optional().describe('Env var to set in the override (default "DATABASE_URL").'),
      force: z.boolean().optional().describe('If the fork already exists, drop and recreate it.'),
      terminateSource: z
        .boolean()
        .optional()
        .describe('Disconnect other sessions on the source DB so the TEMPLATE clone can proceed.'),
      drop: z
        .boolean()
        .optional()
        .describe('Tear down: drop the fork DB (and remove the .env.local override if repointEnv is set).')
    },
    handler: async ({
      connection,
      source,
      fork,
      cwd,
      repointEnv,
      envVar = 'DATABASE_URL',
      force,
      terminateSource,
      drop
    }) => {
      const resolved = resolveConnection(connection);
      const sourceUrl = resolved.url;
      const host = new URL(sourceUrl).hostname;
      if (!isLocalHost(host)) {
        throw new Error(
          `Refusing to fork a remote database (host="${host}"). database_fork only operates on a local server.`
        );
      }

      const defaultDb = decodeDbName(new URL(sourceUrl).pathname.replace(/^\//, ''));
      const sourceDb = source ?? defaultDb;
      if (!sourceDb) {
        throw new Error(`Connection "${resolved.name}" pins no database — pass source.`);
      }
      const branch = fork ? null : cwd ? branchOf(cwd) : null;
      const forkDb = fork ?? (branch ? deriveForkName(sourceDb, branch) : `${sourceDb}_fork`.slice(0, 63));
      assertDbName(sourceDb, 'source');
      assertDbName(forkDb, 'fork');
      if (forkDb === sourceDb) {
        throw new Error(`Fork "${forkDb}" equals the source — nothing to fork.`);
      }
      // Never drop or replace a database any KEVIN_DB_* connection points at —
      // those are real, configured DBs, never fork targets. Covers the active
      // connection's default and every other configured one.
      if (configuredDatabases().has(forkDb)) {
        throw new Error(
          `Refusing to operate on "${forkDb}" — a KEVIN_DB_* connection points at it. Forks must use a separate name.`
        );
      }
      if (repointEnv && (!cwd || !isAbsolute(cwd) || !existsSync(cwd))) {
        throw new Error('repointEnv requires `cwd` to be an absolute path to an existing directory.');
      }

      // DDL can't run in a transaction, so use a dedicated autocommit client on
      // the maintenance DB rather than the read-only pools.
      const client = new pg.Client({ connectionString: resolveConnectionString(sourceUrl, 'postgres') });
      await client.connect();
      try {
        if (drop) {
          await terminateSessions(client, forkDb);
          await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(forkDb)}`);
          const overrideCleared = repointEnv && cwd ? clearEnvOverride(cwd, envVar) : undefined;
          return { dropped: forkDb, connection: resolved.name, overrideCleared: overrideCleared ?? undefined };
        }

        if (await dbExists(client, forkDb)) {
          if (!force) {
            throw new Error(`Database "${forkDb}" already exists. Pass force:true to recreate it.`);
          }
          await terminateSessions(client, forkDb);
          await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(forkDb)}`);
        }
        if (!(await dbExists(client, sourceDb))) {
          throw new Error(`Source database "${sourceDb}" does not exist on connection "${resolved.name}".`);
        }

        if (terminateSource) {
          await terminateSessions(client, sourceDb);
        }
        try {
          await client.query(`CREATE DATABASE ${quoteIdent(forkDb)} TEMPLATE ${quoteIdent(sourceDb)}`);
        } catch (error) {
          // 55006 = object_in_use: the template DB has live sessions. Trust the
          // SQLSTATE over the message text (locale/version-independent).
          if (error instanceof pg.DatabaseError && error.code === '55006') {
            throw new Error(
              `Cannot clone "${sourceDb}" while it has active sessions (e.g. a running dev server). Stop them, or re-run with terminateSource:true.`
            );
          }
          throw error;
        }

        const forkUrl = resolveConnectionString(sourceUrl, forkDb);
        const env = repointEnv && cwd ? writeEnvOverride(cwd, envVar, forkUrl, force === true) : undefined;
        return {
          fork: forkDb,
          source: sourceDb,
          connection: resolved.name,
          host,
          override: env?.written ? env.path : undefined,
          envInstruction:
            env && !env.written
              ? `${OVERRIDE_FILE} already sets ${envVar}; left it as-is. To use the fork, set ${envVar}="${forkUrl}" there yourself, or re-run with force:true to overwrite.`
              : undefined,
          note: 'Run your migrations against the fork; database_fork drop:true tears it down (and removes the .env.local override if repointEnv was set).'
        };
      } finally {
        await client.end();
      }
    }
  })
];
