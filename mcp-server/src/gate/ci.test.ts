import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCiDefaults } from './ci';

const checkout = mkdtempSync(join(tmpdir(), 'gate-ci-test-'));
mkdirSync(join(checkout, '.github', 'workflows'), { recursive: true });
const workflow = (name: string, yaml: string) => {
  writeFileSync(join(checkout, '.github', 'workflows', name), yaml);
  return `.github/workflows/${name}`;
};

afterAll(() => rmSync(checkout, { recursive: true, force: true }));

const CI = `
name: CI
env:
  TURBO_TELEMETRY_DISABLED: "1"
jobs:
  ci:
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: acme
          POSTGRES_PASSWORD: acme_dev
          POSTGRES_DB: acme
    env:
      NEXT_PUBLIC_API_URL: http://localhost:3001
      DATABASE_URL: postgresql://acme:acme_dev@localhost:5432/acme
      RETRIES: 3
      API_TOKEN: \${{ secrets.API_TOKEN }}
`;

describe('readCiDefaults', () => {
  test("reads the job's literal env and its Postgres service, and leaves expressions out", () => {
    expect(readCiDefaults(checkout, { workflow: workflow('ci.yml', CI) })).toEqual({
      env: {
        TURBO_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
        DATABASE_URL: 'postgresql://acme:acme_dev@localhost:5432/acme',
        RETRIES: '3'
      },
      postgres: {
        image: 'postgres:17-alpine',
        user: 'acme',
        password: 'acme_dev',
        database: 'acme',
        urlEnv: ['DATABASE_URL']
      }
    });
  });

  test('a service image that is not the official postgres one is refused', () => {
    const path = workflow('custom.yml', CI.replace('postgres:17-alpine', 'ghcr.io/acme/postgres:17'));

    expect(() => readCiDefaults(checkout, { workflow: path })).toThrow(/only official postgres:<tag> images/);
  });

  test('with several jobs and none named, the job with the Postgres service is used; ambiguity asks for a job', () => {
    const two = workflow('two.yml', `${CI}\n  lint:\n    env:\n      A: b\n`);
    expect(readCiDefaults(checkout, { workflow: two }).postgres?.database).toBe('acme');

    const none = workflow('none.yml', 'jobs:\n  a:\n    env:\n      A: b\n  b:\n    env:\n      B: c\n');
    expect(() => readCiDefaults(checkout, { workflow: none })).toThrow(/Pick a job/);
  });

  test('a postgres service with no password is refused by name, not with a schema error', () => {
    const path = workflow('nopass.yml', CI.replace('          POSTGRES_PASSWORD: acme_dev\n', ''));

    expect(() => readCiDefaults(checkout, { workflow: path })).toThrow(/sets no POSTGRES_PASSWORD/);
  });

  test('a workflow path outside the checkout is refused', () => {
    expect(() => readCiDefaults(checkout, { workflow: '../elsewhere.yml' })).toThrow(/points outside/);
  });
});
