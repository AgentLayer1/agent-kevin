/**
 * Generic Postgres MCP tools. Unlike a hardcoded list of named environments,
 * connections are discovered at call time from any `KEVIN_DB_<NAME>` env var —
 * add a connection by adding a `KEVIN_DB_<NAME>=<connection-string>` line to
 * `.kevin/secrets/.env` (connection strings carry credentials, so they live in the
 * deny-gated secret store; config loads it into the env at boot), no code change.
 * Connections are pooled per (env var, database) and lazy: a
 * connection string may pin a database in its path or omit it entirely, and any
 * call may target a different database on the same server via the optional
 * `database` argument (e.g. a per-worktree `app_<branch>` DB) — no new env var,
 * no reload.
 *
 * Three read-only tools:
 *   database_list   — names + credential-stripped host/db of configured connections
 *   database_schema — list tables, or describe one table's columns
 *   database_query  — arbitrary read-only SQL
 *
 * Every query runs inside a `BEGIN READ ONLY` transaction with a
 * `statement_timeout`, always rolled back — Postgres itself rejects any
 * write (error 25006), so reads are enforced by the server, not by parsing SQL.
 */
import { dbConnections, dbEnvKeyFor, env } from '@/shared/env';
import { defineTool, type ToolDef } from '@/shared/types';
import pg from 'pg';
import { z } from 'zod';

const { Pool } = pg;

/** Connection discovery lives in config (the sole env reader); re-exported here
 *  so the status collector's dynamic `import('database')` keeps finding it. */
export const discoverConnections = dbConnections;

/**
 * Percent-decode a database name read from a URL pathname. A name that was
 * never encoded — or carries a stray "%" — passes through raw rather than
 * throwing, since it came from a config value we don't control.
 */
export const decodeDbName = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/** Parse a connection URL into display metadata, dropping all credentials. */
export const safeConnectionInfo = (url: string): { host: string; port: string; database: string } => {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: decodeDbName(parsed.pathname.replace(/^\//, '')) || ''
    };
  } catch {
    return { host: '(unparseable URL)', port: '', database: '' };
  }
};

/**
 * Assert `name` is a legal Postgres database name — the server's actual rule
 * (1-63 bytes, no NUL), not an ASCII-only subset, so real names like
 * "acme-db" pass. Callers that embed the name in a URL or in DDL are
 * responsible for encoding/quoting it for that context.
 */
export const assertDbName = (name: string, label = 'database name'): void => {
  if (name.length === 0 || name.includes('\0') || new TextEncoder().encode(name).length > 63) {
    throw new Error(`Invalid ${label} "${name}". Expected a 1-63 byte name without NUL.`);
  }
};

/**
 * Resolve the connection string to actually dial: the base as-is, or with its
 * database swapped to `database`. A supplied `database` always wins, even over a
 * database pinned in the base string. Throws when the base carries no database
 * AND none is supplied — node-postgres would otherwise silently fall back to
 * PGDATABASE / the username, connecting somewhere surprising.
 */
export const resolveConnectionString = (url: string, database?: string): string => {
  const parsed = new URL(url);
  if (database !== undefined) {
    assertDbName(database);
    parsed.pathname = `/${encodeURIComponent(database)}`;
    return parsed.toString();
  }
  if (!parsed.pathname.replace(/^\//, '')) {
    throw new Error(`Connection has no default database — pass "database" to target one (e.g. "app_my_branch").`);
  }
  return url;
};

const pools = new Map<string, pg.Pool>();

/**
 * Lazy, cached pool for a connection name, optionally aimed at a specific
 * database on that connection's server. Pools are keyed per (connection,
 * database). Throws (listing names) if the connection is unknown.
 */
const getPool = (name: string, database?: string): pg.Pool => {
  const envKey = dbEnvKeyFor(name);
  const cacheKey = database === undefined ? envKey : `${envKey}::${database}`;
  const existing = pools.get(cacheKey);
  if (existing) return existing;
  const url = env(envKey);
  if (!url) {
    const available = discoverConnections().map((connection) => connection.name);
    const hint = available.length
      ? `Available connections: ${available.join(', ')}.`
      : `No connections configured. Add a KEVIN_DB_<NAME> connection string to .kevin/secrets/.env.`;
    throw new Error(`Unknown database connection "${name}" (looked for ${envKey}). ${hint}`);
  }
  const pool = new Pool({ connectionString: resolveConnectionString(url, database), max: 4 });
  pools.set(cacheKey, pool);
  return pool;
};

/** Run a callback inside a rolled-back READ ONLY transaction with a timeout. */
const inReadOnlyTx = async <Result>(
  name: string,
  timeoutMs: number,
  run: (client: pg.PoolClient) => Promise<Result>,
  database?: string
): Promise<Result> => {
  const client = await getPool(name, database).connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
    return await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
};

const TABLES_SQL = `
  SELECT table_schema AS schema, table_name AS name, table_type AS type
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY table_schema, table_name
`;

const COLUMNS_SQL = `
  SELECT table_schema AS schema, column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS default
  FROM information_schema.columns
  WHERE table_name = $1 AND ($2::text IS NULL OR table_schema = $2)
  ORDER BY table_schema, ordinal_position
`;

export const tools: ToolDef[] = [
  defineTool({
    name: 'database_list',
    description:
      'List the Postgres connections available to query. Each is configured via a KEVIN_DB_<NAME> env var. Returns name + host/port/database only — never credentials or the connection string. A blank `database` means the connection pins no default — pass `database` to database_query/database_schema to pick one; either tool can also override a pinned database per call to reach another DB on the same server.',
    inputSchema: {},
    handler: async () => {
      const connections = discoverConnections().map((connection) => ({
        name: connection.name,
        ...safeConnectionInfo(env(connection.envKey) ?? '')
      }));
      if (!connections.length) {
        return {
          connections: [],
          hint: 'No connections configured. Add a KEVIN_DB_<NAME> connection string (e.g. KEVIN_DB_APP) to .kevin/secrets/.env.'
        };
      }
      return { connections };
    }
  }),
  defineTool({
    name: 'database_schema',
    description:
      'Inspect a Postgres database structure (read-only). Without `table`, lists all user tables {schema, name, type}. With `table`, describes its columns {name, type, nullable, default}. Use this before database_query to learn table and column names.',
    inputSchema: {
      connection: z.string().describe('Connection name from database_list (e.g. "app").'),
      table: z.string().optional().describe('Table name to describe. Omit to list all tables.'),
      schema: z
        .string()
        .optional()
        .describe('Schema to disambiguate when the table name exists in several (e.g. "public").'),
      database: z
        .string()
        .optional()
        .describe(
          'Target a specific database on this connection\'s server, overriding the one in the connection string (e.g. a per-worktree "app_<branch>"). Defaults to the connection\'s configured database; required when the connection string has none.'
        )
    },
    handler: async ({ connection, table, schema, database }) => {
      return inReadOnlyTx(
        connection,
        30000,
        async (client) => {
          if (table) {
            const result = await client.query({ text: COLUMNS_SQL, values: [table, schema ?? null] });
            if (!result.rowCount) throw new Error(`Table "${table}" not found in connection "${connection}".`);
            return { connection, database, table, columns: result.rows };
          }
          const result = await client.query(TABLES_SQL);
          return { connection, database, tableCount: result.rowCount, tables: result.rows };
        },
        database
      );
    }
  }),
  defineTool({
    name: 'database_query',
    description:
      'Run a read-only SQL query against a configured Postgres connection. Executes inside a READ ONLY transaction with a statement timeout — writes (INSERT/UPDATE/DELETE/DDL) are rejected by Postgres. Returns rows + column metadata as JSON.',
    inputSchema: {
      connection: z.string().describe('Connection name from database_list (e.g. "app").'),
      sql: z.string().describe('The SQL statement. Read-only — DML/DDL is rejected by the transaction.'),
      params: z
        .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional()
        .describe('Optional positional parameters ($1, $2, ...).'),
      timeout_ms: z.number().int().min(100).max(300000).optional().describe('Query timeout in ms (default 30000).'),
      database: z
        .string()
        .optional()
        .describe(
          'Target a specific database on this connection\'s server, overriding the one in the connection string (e.g. a per-worktree "app_<branch>"). Defaults to the connection\'s configured database; required when the connection string has none.'
        )
    },
    handler: async ({ connection, sql, params, timeout_ms, database }) => {
      return inReadOnlyTx(
        connection,
        timeout_ms ?? 30000,
        async (client) => {
          const result = await client.query({ text: sql, values: params });
          return {
            connection,
            database,
            rowCount: result.rowCount,
            fields: result.fields.map((field) => ({ name: field.name, dataTypeID: field.dataTypeID })),
            rows: result.rows
          };
        },
        database
      );
    }
  })
];
