import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { gateSettingsFile, readGateSettings } from './settings';

const write = (settings: unknown) => {
  const file = gateSettingsFile('acme');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings));
};

afterEach(() => rmSync(gateSettingsFile('acme'), { force: true }));

describe('readGateSettings', () => {
  test('no settings file means no extras', () => {
    expect(readGateSettings('acme')).toEqual({ env: {}, writable: [] });
  });

  test('reads placeholders, a throwaway Postgres and a cache folder, resolved to an absolute path', () => {
    write({
      env: { NEXT_PUBLIC_API_URL: 'http://localhost:3001' },
      postgres: {
        image: 'postgres:17-alpine',
        user: 'acme',
        password: 'acme_dev',
        database: 'acme',
        urlEnv: ['DATABASE_URL']
      },
      writable: ['~/.cache/prisma']
    });

    expect(readGateSettings('acme')).toEqual({
      env: { NEXT_PUBLIC_API_URL: 'http://localhost:3001' },
      postgres: {
        image: 'postgres:17-alpine',
        user: 'acme',
        password: 'acme_dev',
        database: 'acme',
        urlEnv: ['DATABASE_URL']
      },
      writable: [join(homedir(), '.cache', 'prisma')]
    });
  });

  test('a writable folder outside ~/.cache is refused, however it is spelled', () => {
    ['~/.ssh', '~/.cache/../.ssh', '/etc', '~/.cache'].forEach((path) => {
      write({ writable: [path] });

      expect(() => readGateSettings('acme')).toThrow(/must be a folder under ~\/.cache/);
    });
  });

  test('an unknown key is refused rather than silently ignored', () => {
    write({ network: 'open' });

    expect(() => readGateSettings('acme')).toThrow(/not valid gate settings/);
  });
});
