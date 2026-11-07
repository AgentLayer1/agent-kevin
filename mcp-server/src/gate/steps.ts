import { readTextIfExists } from '@/shared/text';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { PackageManager } from './toolchain';

export interface StepSummary {
  summary: string;
  failures: string[];
}

/**
 * One step of a gate run. A script step runs one of the checkout's package.json scripts; an action runs in the
 * server itself, outside the sandbox (stopping a shared service, say).
 */
export type StepSpec =
  | {
      kind: 'script';
      name: string;
      script: string;
      args?: string[];
      /** A workspace package to run the script in; the script then needn't exist at the root. */
      filter?: string;
      /** Whether a failure skips the steps after it. Defaults to true, as CI does. */
      stopsRun?: boolean;
      /** Prefix of the argument that tells the script where to write a JSON report (`--report=`). */
      reportArg?: string;
      summarize?: (log: string, report: string | undefined) => StepSummary;
      /** Reach the run's services (a database): started before the first such step, their ports and env go only to these steps. */
      needsServices?: boolean;
    }
  | { kind: 'install'; name: string }
  | { kind: 'selftest'; name: string; needsServices?: boolean }
  | { kind: 'action'; name: string; run: () => Promise<string> };

export const stepCommand = (
  step: Extract<StepSpec, { kind: 'script' | 'install' }>,
  { pm, pmBin }: { pm: PackageManager; pmBin: string },
  reportFile?: string
): string[] => {
  if (step.kind === 'install') {
    return [pmBin, 'install'];
  }
  const filter = step.filter === undefined ? undefined : checkedPackage(step.filter);
  const args = [...(step.args ?? []), ...(step.reportArg && reportFile ? [`${step.reportArg}${reportFile}`] : [])];
  switch (pm) {
    case 'pnpm':
      return [pmBin, ...(filter ? ['--filter', filter] : []), 'run', step.script, ...args];
    case 'npm':
      return [
        pmBin,
        'run',
        step.script,
        ...(filter ? ['--workspace', filter] : []),
        ...(args.length ? ['--', ...args] : [])
      ];
    case 'yarn':
      return [pmBin, ...(filter ? ['workspace', filter] : []), 'run', step.script, ...args];
    case 'bun':
      return [pmBin, 'run', ...(filter ? ['--filter', filter] : []), step.script, ...args];
  }
};

/**
 * Refuses a script step whose script the checkout's package.json doesn't define, naming the ones it does.
 */
export const checkScripts = (steps: StepSpec[], scripts: Record<string, string>): void => {
  const missing = steps.flatMap((step) =>
    step.kind === 'script' && step.filter === undefined && !(step.script in scripts) ? [step.script] : []
  );
  if (missing.length) {
    throw new Error(
      `No package.json script named ${missing.map((name) => `"${name}"`).join(', ')}. It has: ${Object.keys(scripts).join(', ') || 'none'}.`
    );
  }
};

const user = userInfo().username;

/**
 * The whole environment a step sees: nothing from the server's own (which holds the home's secrets), and no `CI`,
 * which changes how pnpm installs and how Next builds, so a gate matches the operator's own runs. `extra` (the
 * repo's placeholders and the run's service URLs) is layered on top.
 */
export const stepEnv = ({
  path,
  tmp,
  runId,
  pm,
  storeDir,
  extra = {}
}: {
  path: string;
  tmp: string;
  runId: string;
  pm: PackageManager;
  storeDir?: string;
  extra?: Record<string, string>;
}): Record<string, string> => ({
  PATH: path,
  HOME: homedir(),
  USER: user,
  LOGNAME: user,
  LANG: 'en_US.UTF-8',
  TMPDIR: tmp,
  TERM: 'dumb',
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  AGENT_GATE_RUN: runId,
  // Turbo shares one cache across git worktrees; this keeps each checkout's inside it, as CI does.
  TURBO_CACHE_DIR: '.turbo/cache',
  TURBO_TELEMETRY_DISABLED: '1',
  NEXT_TELEMETRY_DISABLED: '1',
  DO_NOT_TRACK: '1',
  CHECKPOINT_DISABLE: '1',
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  COREPACK_ENABLE_AUTO_PIN: '0',
  ...(pm === 'pnpm' && {
    // The sandbox can't read ~/.npmrc, so pnpm is told the store the last install used; another store makes it recreate node_modules.
    ...(storeDir && { pnpm_config_store_dir: storeDir }),
    // A script run must never turn into an install: stale dependencies fail the step and point at gate_install.
    pnpm_config_verify_deps_before_run: 'error'
  }),
  ...extra
});

/**
 * The pnpm store the checkout's last install linked from (its `node_modules/.modules.yaml`), else the first of
 * `fallbacks` that has one, so a fresh worktree installs from the same store as the main checkout.
 */
export const installedStoreDir = (checkout: string, fallbacks: string[] = []): string => {
  const found = [checkout, ...fallbacks]
    .map((candidate) =>
      readTextIfExists(join(candidate, 'node_modules', '.modules.yaml'))
        .match(/"?storeDir"?:\s*"?([^",\n]+)"?/)?.[1]
        ?.trim()
    )
    .find((storeDir) => storeDir?.startsWith('/'));
  if (!found) {
    throw new Error(
      `No pnpm install found in ${checkout} or its main checkout, so the gate can't tell which pnpm store to use. Run pnpm install there once yourself.`
    );
  }
  return found;
};

/**
 * The turbo run summary written during this step (`--summarize`), as tasks passed and the ids of those that failed.
 */
export const turboSummary = (checkout: string, since: number): StepSummary | undefined => {
  const dir = join(checkout, '.turbo', 'runs');
  try {
    const newest = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({ file: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
      .filter(({ mtime }) => mtime >= since)
      .sort((left, right) => right.mtime - left.mtime)[0];
    return newest ? parseTurboSummary(readFileSync(newest.file, 'utf8')) : undefined;
  } catch {
    return undefined;
  }
};

export const parseTurboSummary = (json: string): StepSummary | undefined => {
  try {
    const run = JSON.parse(json) as {
      execution?: { success?: number; failed?: number; cached?: number; attempted?: number };
      tasks?: { taskId?: string; execution?: { exitCode?: number } }[];
    };
    const { success = 0, failed = 0, cached = 0, attempted = 0 } = run.execution ?? {};
    return {
      summary: `${success + cached} of ${attempted} tasks passed${failed ? `, ${failed} failed` : ''} (${cached} from cache)`,
      failures: (run.tasks ?? [])
        .filter((task) => (task.execution?.exitCode ?? 0) !== 0)
        .map((task) => task.taskId ?? 'unknown task')
    };
  } catch {
    return undefined;
  }
};

export const checkedPackage = (name: string): string => {
  if (!/^@?\w[\w.-]*(\/\w[\w.-]*)?$/.test(name)) {
    throw new Error(`"${name}" is not a package name (e.g. @acme/utils).`);
  }
  return name;
};
