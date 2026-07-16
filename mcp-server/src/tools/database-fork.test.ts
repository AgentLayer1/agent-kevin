import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  configuredDatabases,
  deriveForkName,
  isLocalHost,
  quoteIdent,
  readEnvLine,
  removeEnvLine,
  upsertEnvLine
} from '@/tools/database-fork';

describe('quoteIdent', () => {
  test('wraps a plain name in double quotes', () => {
    expect(quoteIdent('acme-db')).toBe('"acme-db"');
    expect(quoteIdent('app_fork')).toBe('"app_fork"');
  });

  test('doubles embedded quotes — the complete identifier escape rule', () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(quoteIdent('a""b')).toBe('"a""""b"');
  });
});

describe('deriveForkName', () => {
  test('slugifies the branch and prefixes the source DB', () => {
    expect(deriveForkName('acme', 'basem/ac-002-shared-db')).toBe('acme_basem_ac_002_shared_db');
  });

  test('keeps a hyphenated source name verbatim in the prefix', () => {
    expect(deriveForkName('acme-db', 'basem/feature-redemption')).toBe('acme-db_basem_feature_redemption');
  });

  test('collapses runs of non-alphanumerics and trims edges', () => {
    expect(deriveForkName('app', 'feat//Foo--Bar__')).toBe('app_feat_foo_bar');
  });

  test('falls back to _fork when the branch slugifies to nothing', () => {
    expect(deriveForkName('app', '---')).toBe('app_fork');
  });

  test('clamps to the 63-char Postgres identifier limit', () => {
    expect(deriveForkName('app', 'x'.repeat(80)).length).toBe(63);
  });
});

describe('upsertEnvLine', () => {
  test('appends the override when absent, with a trailing newline', () => {
    expect(upsertEnvLine('', 'DATABASE_URL', 'postgres://h/fork')).toBe('DATABASE_URL="postgres://h/fork"\n');
    expect(upsertEnvLine('FOO=bar\n', 'DATABASE_URL', 'x')).toBe('FOO=bar\nDATABASE_URL="x"\n');
  });

  test('replaces an existing line in place, leaving others untouched', () => {
    const out = upsertEnvLine('DATABASE_URL="old"\nFOO=bar\n', 'DATABASE_URL', 'new');
    expect(out).toBe('DATABASE_URL="new"\nFOO=bar\n');
  });
});

describe('isLocalHost', () => {
  test('accepts loopback hosts and an empty (unix-socket) host', () => {
    for (const host of ['', 'localhost', '127.0.0.1', '::1', '[::1]']) {
      expect(isLocalHost(host)).toBe(true);
    }
  });

  test('refuses remote hosts, including ones that merely look local', () => {
    for (const host of ['db.example.com', 'localhost.evil.com', '10.0.0.5', '0.0.0.0', 'rds.amazonaws.com']) {
      expect(isLocalHost(host)).toBe(false);
    }
  });
});

describe('readEnvLine', () => {
  test('returns the current value with surrounding quotes stripped', () => {
    expect(readEnvLine('DATABASE_URL="postgres://h/db"\n', 'DATABASE_URL')).toBe('postgres://h/db');
    expect(readEnvLine('FOO=bar\n', 'FOO')).toBe('bar');
  });

  test('returns null when the var is absent', () => {
    expect(readEnvLine('FOO=bar\n', 'DATABASE_URL')).toBeNull();
    expect(readEnvLine('', 'DATABASE_URL')).toBeNull();
  });
});

describe('removeEnvLine', () => {
  test('removes the line and returns null when nothing else remains', () => {
    expect(removeEnvLine('DATABASE_URL="x"\n', 'DATABASE_URL')).toBeNull();
  });

  test('keeps other lines when present', () => {
    expect(removeEnvLine('FOO=bar\nDATABASE_URL="x"\n', 'DATABASE_URL')).toBe('FOO=bar\n');
  });
});

describe('configuredDatabases', () => {
  const added: string[] = [];
  const setEnv = (key: string, value: string) => {
    added.push(key);
    process.env[key] = value;
  };
  beforeEach(() => {
    added.length = 0;
  });
  afterEach(() => {
    for (const key of added) delete process.env[key];
  });

  test('collects the pinned database of every KEVIN_DB_* connection', () => {
    setEnv('KEVIN_DB_APP', 'postgres://u:p@localhost:5432/app');
    setEnv('KEVIN_DB_ANALYTICS', 'postgres://u:p@remote:5432/analytics');
    const dbs = configuredDatabases();
    expect(dbs.has('app')).toBe(true);
    expect(dbs.has('analytics')).toBe(true);
  });

  test('skips a connection that pins no database', () => {
    setEnv('KEVIN_DB_NODB', 'postgres://u:p@localhost:5432');
    expect(configuredDatabases().has('')).toBe(false);
  });
});
