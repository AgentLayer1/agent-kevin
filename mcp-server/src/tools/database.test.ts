import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { assertDbName, discoverConnections, resolveConnectionString, safeConnectionInfo } from '@/tools/database';

describe('discoverConnections', () => {
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

  test('discovers KEVIN_DB_* vars, lowercases the name, sorts by name', () => {
    setEnv('KEVIN_DB_ZED', 'postgres://u:p@h/z');
    setEnv('KEVIN_DB_ANALYTICS', 'postgres://u:p@h/a');
    const names = discoverConnections().map((connection) => connection.name);
    expect(names).toContain('analytics');
    expect(names).toContain('zed');
    expect(names.indexOf('analytics')).toBeLessThan(names.indexOf('zed'));
  });

  test('ignores empty values and the bare prefix', () => {
    setEnv('KEVIN_DB_EMPTY', '   ');
    setEnv('KEVIN_DB_', 'postgres://u:p@h/x');
    const names = discoverConnections().map((connection) => connection.name);
    expect(names).not.toContain('empty');
    expect(names).not.toContain('');
  });
});

describe('safeConnectionInfo', () => {
  test('strips username and password, keeps host/port/database', () => {
    const info = safeConnectionInfo('postgres://admin:secret@db.example.com:6543/analytics');
    expect(info).toEqual({ host: 'db.example.com', port: '6543', database: 'analytics' });
    const serialized = JSON.stringify(info);
    expect(serialized).not.toContain('admin');
    expect(serialized).not.toContain('secret');
  });

  test('defaults the port to 5432 when absent', () => {
    expect(safeConnectionInfo('postgres://u:p@localhost/app').port).toBe('5432');
  });

  test('does not throw on an unparseable URL', () => {
    expect(safeConnectionInfo('not a url').host).toBe('(unparseable URL)');
  });

  test('passes a name with a stray "%" through raw instead of throwing', () => {
    expect(safeConnectionInfo('postgres://u:p@h:5432/my%zzdb').database).toBe('my%zzdb');
  });
});

describe('resolveConnectionString', () => {
  test('swaps the database, preserving credentials and host/port', () => {
    const out = resolveConnectionString('postgres://admin:secret@db.example.com:6543/app', 'app_my_branch');
    expect(safeConnectionInfo(out)).toEqual({ host: 'db.example.com', port: '6543', database: 'app_my_branch' });
    expect(out).toContain('admin');
    expect(out).toContain('secret');
  });

  test('overrides a database pinned in the base string', () => {
    expect(safeConnectionInfo(resolveConnectionString('postgres://u:p@h:5432/app', 'app_other')).database).toBe(
      'app_other'
    );
  });

  test('targets a database when the base string has none', () => {
    expect(safeConnectionInfo(resolveConnectionString('postgres://u:p@h:5432', 'app_x')).database).toBe('app_x');
  });

  test('returns the base unchanged when a database is pinned and none is supplied', () => {
    const base = 'postgres://u:p@h:5432/app';
    expect(resolveConnectionString(base)).toBe(base);
  });

  test('throws when the base has no database and none is supplied', () => {
    expect(() => resolveConnectionString('postgres://u:p@h:5432')).toThrow(/no default database/);
  });

  test('accepts a hyphenated name and round-trips it through the URL', () => {
    const out = resolveConnectionString('postgres://u:p@h:5432/app', 'acme-db');
    expect(safeConnectionInfo(out).database).toBe('acme-db');
  });

  test('URL-encodes names with reserved characters, round-tripping intact', () => {
    for (const name of ['my db', 'a/b', 'we"ird']) {
      expect(safeConnectionInfo(resolveConnectionString('postgres://u:p@h:5432/app', name)).database).toBe(name);
    }
  });

  test('rejects an invalid database name', () => {
    expect(() => resolveConnectionString('postgres://u:p@h:5432/app', '')).toThrow(/Invalid database name/);
    expect(() => resolveConnectionString('postgres://u:p@h:5432/app', 'nul\0name')).toThrow(/Invalid database name/);
    expect(() => resolveConnectionString('postgres://u:p@h:5432/app', 'x'.repeat(64))).toThrow(/Invalid database name/);
  });
});

describe('assertDbName', () => {
  test('accepts legal names regardless of charset', () => {
    for (const name of ['app', 'acme-db', 'my db', 'Ünïcode', 'x'.repeat(63)]) {
      expect(() => assertDbName(name)).not.toThrow();
    }
  });

  test('enforces the 63-byte limit in bytes, not characters', () => {
    expect(() => assertDbName('é'.repeat(32))).toThrow(/Invalid database name/); // 64 bytes in UTF-8
  });

  test('labels the error for the caller', () => {
    expect(() => assertDbName('', 'source')).toThrow(/Invalid source/);
  });
});
