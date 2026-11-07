import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkScripts, installedStoreDir, parseTurboSummary, type StepSpec, stepCommand, stepEnv } from './steps';

const build = { kind: 'script', name: 'build', script: 'build' } satisfies StepSpec;

describe('stepCommand', () => {
  test("runs a script through each package manager's own syntax, the filter where that manager expects it", () => {
    const filtered = { ...build, filter: '@acme/utils', args: ['--force'] };

    expect(stepCommand(filtered, { pm: 'pnpm', pmBin: 'pnpm' })).toEqual([
      'pnpm',
      '--filter',
      '@acme/utils',
      'run',
      'build',
      '--force'
    ]);
    expect(stepCommand(filtered, { pm: 'npm', pmBin: 'npm' })).toEqual([
      'npm',
      'run',
      'build',
      '--workspace',
      '@acme/utils',
      '--',
      '--force'
    ]);
    expect(stepCommand(filtered, { pm: 'yarn', pmBin: 'yarn' })).toEqual([
      'yarn',
      'workspace',
      '@acme/utils',
      'run',
      'build',
      '--force'
    ]);
    expect(stepCommand(filtered, { pm: 'bun', pmBin: 'bun' })).toEqual([
      'bun',
      'run',
      '--filter',
      '@acme/utils',
      'build',
      '--force'
    ]);
  });

  test('npm gets no stray -- when there are no arguments', () => {
    expect(stepCommand(build, { pm: 'npm', pmBin: 'npm' })).toEqual(['npm', 'run', 'build']);
  });

  test('a report argument names the file the step writes its JSON to', () => {
    const step = {
      kind: 'script',
      name: 'scenarios',
      script: 'scenario',
      args: ['check'],
      reportArg: '--report='
    } satisfies StepSpec;

    expect(stepCommand(step, { pm: 'pnpm', pmBin: 'pnpm' }, '/logs/scenarios.json')).toEqual([
      'pnpm',
      'run',
      'scenario',
      'check',
      '--report=/logs/scenarios.json'
    ]);
  });

  test('an install is the package manager install, nothing else', () => {
    expect(stepCommand({ kind: 'install', name: 'install' }, { pm: 'pnpm', pmBin: '/node/bin/pnpm' })).toEqual([
      '/node/bin/pnpm',
      'install'
    ]);
  });

  test('a filter that is not a package name is refused', () => {
    expect(() => stepCommand({ ...build, filter: '; rm -rf /' }, { pm: 'pnpm', pmBin: 'pnpm' })).toThrow(
      /not a package name/
    );
  });
});

describe('checkScripts', () => {
  const scripts = { build: 'turbo build', lint: 'turbo lint' };

  test("refuses a script the checkout doesn't define, naming the ones it does", () => {
    expect(() => checkScripts([build, { kind: 'script', name: 'deploy', script: 'deploy' }], scripts)).toThrow(
      'No package.json script named "deploy". It has: build, lint.'
    );
  });

  test('a filtered step is left to its workspace package, and the built-in steps need no script', () => {
    expect(() =>
      checkScripts(
        [
          { kind: 'script', name: 'generate', script: 'prisma:generate', filter: '@acme/db' },
          { kind: 'selftest', name: 'selftest' },
          { kind: 'install', name: 'install' }
        ],
        scripts
      )
    ).not.toThrow();
  });
});

describe('stepEnv', () => {
  const base = { path: '/node/bin:/usr/bin', tmp: '/scratch/tmp', runId: 'run-1' };

  test("carries nothing from the server's environment and never sets CI", () => {
    process.env.GATE_STEP_ENV_SECRET = 'leak';
    const env = stepEnv({ ...base, pm: 'npm' });
    delete process.env.GATE_STEP_ENV_SECRET;

    expect(Object.values(env)).not.toContain('leak');
    expect(env.CI).toBeUndefined();
    expect(env.PATH).toBe('/node/bin:/usr/bin');
    expect(env.TMPDIR).toBe('/scratch/tmp');
  });

  test('pnpm is pinned to the installed store and refuses to turn a script run into an install', () => {
    const env = stepEnv({ ...base, pm: 'pnpm', storeDir: '/store/v11' });

    expect(env.pnpm_config_store_dir).toBe('/store/v11');
    expect(env.pnpm_config_verify_deps_before_run).toBe('error');
    expect(env.pnpm_config_confirm_modules_purge).toBe('false');
    expect(stepEnv({ ...base, pm: 'bun' }).pnpm_config_verify_deps_before_run).toBeUndefined();
  });

  test("the repo's placeholders and the run's service URLs go on top of the base", () => {
    const env = stepEnv({
      ...base,
      pm: 'pnpm',
      extra: { DATABASE_URL: 'postgresql://acme@127.0.0.1:55001/acme', TMPDIR: '/elsewhere' }
    });

    expect(env.DATABASE_URL).toBe('postgresql://acme@127.0.0.1:55001/acme');
    expect(env.TMPDIR).toBe('/elsewhere');
  });
});

describe('installedStoreDir', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-store-test-'));
  const installed = (name: string, storeDir: string) => {
    mkdirSync(join(root, name, 'node_modules'), { recursive: true });
    writeFileSync(
      join(root, name, 'node_modules', '.modules.yaml'),
      `{\n  "layoutVersion": 5,\n  "storeDir": "${storeDir}",\n  "virtualStoreDir": ".pnpm"\n}\n`
    );
  };
  installed('acme', '/dev/.pnpm-store/v11');
  mkdirSync(join(root, 'acme-fresh'));

  test("reads the store from the checkout's own install", () => {
    expect(installedStoreDir(join(root, 'acme'))).toBe('/dev/.pnpm-store/v11');
  });

  test("a worktree with no install yet uses the main checkout's store", () => {
    expect(installedStoreDir(join(root, 'acme-fresh'), [join(root, 'acme')])).toBe('/dev/.pnpm-store/v11');
  });

  test('no install anywhere is an error, never a guessed store', () => {
    expect(() => installedStoreDir(join(root, 'acme-fresh'))).toThrow(/No pnpm install found/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('parseTurboSummary', () => {
  test('counts cache hits as passed and names the failed tasks', () => {
    const summary = parseTurboSummary(
      JSON.stringify({
        execution: { success: 1, failed: 1, cached: 3, attempted: 5, exitCode: 1 },
        tasks: [
          { taskId: '@acme/config#build', execution: { exitCode: 0 } },
          { taskId: '@acme/api#test', execution: { exitCode: 1 } }
        ]
      })
    );

    expect(summary).toEqual({ summary: '4 of 5 tasks passed, 1 failed (3 from cache)', failures: ['@acme/api#test'] });
  });

  test('anything but JSON is no summary, never a pass', () => {
    expect(parseTurboSummary('not json')).toBeUndefined();
  });
});
