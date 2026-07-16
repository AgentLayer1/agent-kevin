import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { readEnvFile } from './env';

// KEVIN_HOME-dependent assertions run synchronously (no awaits) so the mutation
// never interleaves with pipeline.test.ts, which shares process.env.

describe('readEnvFile', () => {
  test('parses a standalone .env into a map', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'kevin-flowenv-'));
    writeFileSync(resolve(dir, '.env'), '# comment\nCARD=4111111111111111\nCVV="123"\n\nEMPTY=\n');
    expect(readEnvFile(resolve(dir, '.env'))).toEqual({ CARD: '4111111111111111', CVV: '123', EMPTY: '' });
  });

  test('returns {} for an absent file', () => {
    expect(readEnvFile(resolve(tmpdir(), 'kevin-does-not-exist-xyz', '.env'))).toEqual({});
  });

  test('refuses to read the agent secret store, even when a real .env sits there', () => {
    const home = mkdtempSync(resolve(tmpdir(), 'kevin-home-'));
    const secretsPath = resolve(home, '.kevin', 'secrets', '.env');
    mkdirSync(resolve(home, '.kevin', 'secrets'), { recursive: true });
    writeFileSync(secretsPath, 'GITHUB_TOKEN=ghp_realsecretvalue\n');
    const flowPath = resolve(home, '.claude', 'browser-flows', 'x', '.env');
    mkdirSync(resolve(home, '.claude', 'browser-flows', 'x'), { recursive: true });
    writeFileSync(flowPath, 'CARD=4111111111111111\n');

    const original = process.env.KEVIN_HOME;
    process.env.KEVIN_HOME = home;
    try {
      expect(readEnvFile(secretsPath)).toEqual({});
      expect(readEnvFile(resolve(home, '.kevin', 'secrets', 'nested', '.env'))).toEqual({});
      expect(readEnvFile(flowPath)).toEqual({ CARD: '4111111111111111' });
    } finally {
      if (original === undefined) {
        delete process.env.KEVIN_HOME;
      } else {
        process.env.KEVIN_HOME = original;
      }
    }
  });
});
