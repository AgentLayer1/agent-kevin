import { LOCKFILES, readPkg } from '@/shared/package-manager';
import { activeGroups, type GroupResult, runGroup } from '@/shared/process-group';
import { readTextIfExists } from '@/shared/text';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { busyProcesses } from './live-processes';
import { acquireCheckoutLock } from './lock';
import { listeningPorts } from './ports';
import { sandboxProfile } from './profile';
import { judgeSelftest, SELFTEST_SCRIPT, selftestProbes } from './selftest';
import { checkScripts, installedStoreDir, type StepSpec, stepCommand, stepEnv, turboSummary } from './steps';
import { resolveToolchain } from './toolchain';

/** Services the gate starts for one run (a throwaway database): the only listening ports its steps may reach. */
export interface GateServices {
  start: (
    runId: string,
    signal?: AbortSignal
  ) => Promise<{ ports: number[]; env: Record<string, string>; summary: string }>;
  stop: () => Promise<void>;
}

export interface GateRequest {
  checkout: string;
  steps: StepSpec[];
  /** Each run's logs go in a folder of their own here; the newest 10 are kept. */
  logsRoot: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Values every step sees on top of the scrubbed base, e.g. the repo's CI placeholders. */
  env?: Record<string, string>;
  /** Paths outside the checkout a step may write (a tool's cache). */
  writable?: string[];
  services?: GateServices;
  /** Checkouts whose pnpm install names the store, when this one (a fresh worktree) has none yet. */
  storeFallbacks?: string[];
  /** Entry points beyond the usual dev tools that mean the checkout is busy (a repo's own test harness). */
  devTools?: string[];
}

/**
 * Runs gate steps on one checkout, each under a fresh Seatbelt profile in its own process group, holding the
 * checkout's lock throughout. Its scratch folder is gone when it returns.
 */
export const runGate = async (request: GateRequest): Promise<GateReport> => {
  if (process.platform !== 'darwin') {
    // TODO(windows): no Seatbelt equivalent wired up; Linux would need bubblewrap.
    throw new Error(
      `The gate isolates each step with macOS sandbox-exec, so it runs only on macOS (this is ${process.platform}).`
    );
  }
  if (!existsSync(SANDBOX_EXEC)) {
    throw new Error(`${SANDBOX_EXEC} is missing, so steps can't be isolated; refusing to run them unsandboxed.`);
  }

  const { checkout, steps, signal } = request;
  const realCheckout = realpathSync(checkout);
  const pkg = readPkg(realCheckout);
  checkScripts(steps, pkg.scripts ?? {});
  const runId = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${randomBytes(3).toString('hex')}`;
  const lock = acquireCheckoutLock(realCheckout, runId);
  const logs = join(request.logsRoot, runId);
  const deadline = Date.now() + request.timeoutMs;
  let base: string | undefined;
  let servicesStarted = false;

  try {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'agent-gate-')));
    const scratch = join(base, 'tmp');
    mkdirSync(scratch);

    if (steps.some(touchesCheckout)) {
      const busy = describeBusy(realCheckout, request.devTools);
      if (busy) {
        throw new Error(
          `Dev tooling is running in ${checkout}, and a gate would rebuild underneath it:\n${busy}\nStop it, or gate a worktree instead.`
        );
      }
    }
    mkdirSync(logs, { recursive: true });

    const toolchain = resolveToolchain(realCheckout, pkg);
    const storeDir = toolchain.pm === 'pnpm' ? installedStoreDir(realCheckout, request.storeFallbacks) : undefined;
    const envWith = (services: StartedServices) =>
      stepEnv({
        path: toolchain.path,
        tmp: scratch,
        runId,
        pm: toolchain.pm,
        storeDir,
        extra: { ...request.env, ...services.env }
      });
    // An install writes the store it links from and pnpm's metadata cache; nothing else in the home.
    const installWritable = storeDir ? [storeDir, join(homedir(), 'Library', 'Caches', 'pnpm')] : [];
    const profile = join(base, 'profile.sb');

    const run: Run = (
      command,
      { logFile, install = false, listening = listeningPorts(), services = NO_SERVICES } = {}
    ) => {
      writeFileSync(
        profile,
        sandboxProfile({
          checkout: realCheckout,
          scratch,
          network: install ? 'open' : 'loopback',
          listening,
          allowedPorts: services.ports,
          extraWritable: [...(request.writable ?? []), ...(install ? installWritable : [])]
        })
      );
      return runGroup([SANDBOX_EXEC, '-f', profile, '/usr/bin/nice', '-n', '10', ...command], {
        cwd: realCheckout,
        env: envWith(services),
        logFile,
        timeoutMs: Math.max(deadline - Date.now(), 1_000),
        signal,
        onStart: (pgid) => lock.setGroup(pgid)
      });
    };

    const context = { realCheckout, base, scratch, logs, toolchain, run };
    const startServices = async (): Promise<StartedServices> => {
      servicesStarted = true;
      return (await request.services?.start(runId, signal)) ?? NO_SERVICES;
    };
    const { results, services } = await steps.reduce<Promise<Progress>>(
      async (previous, step) => {
        const done = await previous;
        const halted =
          done.results.some((result) => !result.ok && result.stopsRun) || signal?.aborted || Date.now() >= deadline;
        const busy =
          !halted && touchesCheckout(step) && done.results.length ? describeBusy(realCheckout, request.devTools) : '';

        if (halted || busy) {
          const summary = busy
            ? `not run: dev tooling started in this checkout during the gate:\n${busy}`
            : 'not run: an earlier step failed, the call was cancelled, or time ran out';
          const skipped: StepResult = {
            step: step.name,
            ok: false,
            skipped: true,
            stopsRun: false,
            summary,
            failures: []
          };
          return { ...done, results: [...done.results, skipped] };
        }

        const before = done.lastStatus ?? gitStatus(realCheckout);
        const failed = (error: unknown): StepResult => ({
          step: step.name,
          ok: false,
          stopsRun: step.kind === 'install' || (step.kind === 'script' && step.stopsRun !== false),
          summary: error instanceof Error ? error.message : String(error),
          failures: []
        });
        const start: { services?: StartedServices; failure?: StepResult } =
          !done.services && needsServices(step)
            ? await startServices().then(
                (services) => ({ services }),
                (error: unknown) => ({ failure: failed(error) })
              )
            : { services: done.services };
        const stepServices = start.services && needsServices(step) ? start.services : NO_SERVICES;
        const result = start.failure ?? (await runStep(step, { ...context, services: stepServices }).catch(failed));
        const after = gitStatus(realCheckout);
        const changedFiles = [...after].filter((line) => !before.has(line));
        return {
          results: [...done.results, changedFiles.length ? { ...result, changedFiles } : result],
          lastStatus: after,
          services: start.services
        };
      },
      Promise.resolve({ results: [] })
    );

    return {
      checkout: realCheckout,
      runId,
      logs,
      ...(services?.summary && { services: services.summary }),
      ...(lock.notice && { notice: lock.notice }),
      ok: results.every((result) => result.ok),
      steps: results
    };
  } finally {
    if (servicesStarted) {
      await request.services?.stop();
    }
    lock.release();
    if (base) {
      rmSync(base, { recursive: true, force: true });
    }
    pruneRuns(request.logsRoot);
  }
};

const runStep = async (step: StepSpec, context: StepContext): Promise<StepResult> => {
  const { realCheckout, base, scratch, logs, toolchain, services, run } = context;
  const slug = step.name.replace(/[^\w.-]/g, '-');
  const logFile = join(logs, `${slug}.log`);
  const started = Date.now();

  switch (step.kind) {
    case 'action': {
      const summary = await step.run();
      return { step: step.name, ok: true, stopsRun: false, summary, failures: [] };
    }

    case 'selftest': {
      const nodeBin = Bun.which('node', { PATH: toolchain.path });
      if (!nodeBin) {
        throw new Error(`No node on the step's PATH (${toolchain.path}) to run the selftest with.`);
      }
      const script = join(base, 'selftest.cjs');
      writeFileSync(script, SELFTEST_SCRIPT);
      const listening = listeningPorts();
      const probes = selftestProbes({
        checkout: realCheckout,
        scratch,
        serverPid: process.pid,
        listening,
        allowedPorts: services.ports
      });
      const result = await run([nodeBin, script, JSON.stringify(probes)], { listening, services });
      const judged = judgeSelftest(probes, result.stdout);
      const failed = judged.filter((probe) => !probe.ok);
      return {
        step: step.name,
        ok: result.exitCode === 0 && failed.length === 0,
        stopsRun: false,
        exitCode: result.exitCode,
        seconds: result.seconds,
        summary: `${judged.length - failed.length} of ${judged.length} isolation probes behaved as required`,
        failures: failed.map(
          (probe) => `${probe.name}: expected ${probe.expect}, got ${probe.outcome} (${probe.detail})`
        ),
        probes: judged.map(({ name, expect, outcome, detail, ok }) => ({ name, expect, outcome, detail, ok })),
        ...(result.exitCode !== 0 && { tail: tail(result.stderr) })
      };
    }

    case 'install':
    case 'script': {
      const reportFile = step.kind === 'script' && step.reportArg ? join(logs, `${slug}.json`) : undefined;
      const result = await run(stepCommand(step, toolchain, reportFile), {
        logFile,
        install: step.kind === 'install',
        services
      });
      const log = readTextIfExists(logFile);
      const summarize = step.kind === 'script' ? step.summarize : undefined;
      const parsed =
        step.kind !== 'script'
          ? undefined
          : summarize
            ? summarize(log, reportFile && readTextIfExists(reportFile))
            : turboSummary(realCheckout, started);
      return {
        step: step.name,
        ok: result.exitCode === 0 && !result.stopped,
        stopsRun: step.kind === 'install' || step.stopsRun !== false,
        exitCode: result.exitCode,
        seconds: result.seconds,
        ...(result.stopped && { stopped: result.stopped }),
        summary: parsed?.summary || (result.exitCode === 0 ? 'passed' : `exited ${result.exitCode}`),
        failures: parsed?.failures ?? [],
        log: logFile,
        ...(result.exitCode !== 0 && { tail: tail(log) }),
        ...(step.kind === 'install' && { lockfile: lockfileDiff(realCheckout) })
      };
    }
  }
};

const lockfileDiff = (checkout: string): string =>
  git(checkout, [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--stat',
    '--',
    ...LOCKFILES.map(({ file }) => file)
  ]).trim() || 'lockfile unchanged';

const touchesCheckout = (step: StepSpec): boolean => step.kind === 'script' || step.kind === 'install';

const describeBusy = (checkout: string, devTools?: string[]): string =>
  busyProcesses(checkout, activeGroups, devTools)
    .map((item) => `  pid ${item.pid}: ${item.command.slice(0, 160)}`)
    .join('\n');

const gitStatus = (checkout: string): Set<string> =>
  new Set(git(checkout, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean));

/**
 * Git run outside the sandbox with hooks and fsmonitor off; a step can't write `.git` to add any other command.
 */
const git = (checkout: string, args: string[]): string =>
  Bun.spawnSync(['git', '-C', checkout, '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    timeout: 60_000
  }).stdout.toString();

const pruneRuns = (logsRoot: string, keep = 10): void => {
  if (!existsSync(logsRoot)) {
    return;
  }
  readdirSync(logsRoot)
    .filter((name) => RUN_ID.test(name))
    .sort()
    .reverse()
    .slice(keep)
    .forEach((name) => rmSync(join(logsRoot, name), { recursive: true, force: true }));
};

const tail = (text: string, limit = 3_000): string =>
  text.length <= limit ? text.trim() : `…${text.slice(-limit).trim()}`;

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const RUN_ID = /^\d{8}T\d{6}-[0-9a-f]{6}$/;

type StartedServices = Awaited<ReturnType<GateServices['start']>>;

const NO_SERVICES: StartedServices = { ports: [], env: {}, summary: '' };

const needsServices = (step: StepSpec): boolean =>
  (step.kind === 'script' || step.kind === 'selftest') && step.needsServices === true;

interface Progress {
  results: StepResult[];
  lastStatus?: Set<string>;
  services?: StartedServices;
}

type Run = (
  command: string[],
  options?: { logFile?: string; install?: boolean; listening?: number[]; services?: StartedServices }
) => Promise<GroupResult>;

interface StepContext {
  realCheckout: string;
  base: string;
  scratch: string;
  logs: string;
  toolchain: ReturnType<typeof resolveToolchain>;
  services: StartedServices;
  run: Run;
}

interface StepResult {
  step: string;
  ok: boolean;
  /** Whether this step's failure skips the steps after it. */
  stopsRun: boolean;
  skipped?: true;
  exitCode?: number | null;
  seconds?: number;
  stopped?: 'timeout' | 'cancel';
  summary: string;
  failures: string[];
  log?: string;
  tail?: string;
  probes?: { name: string; expect: string; outcome: string; detail: string; ok: boolean }[];
  lockfile?: string;
  /** `git status` lines this step added: tracked files it rewrote or new files it left. */
  changedFiles?: string[];
}

interface GateReport {
  checkout: string;
  runId: string;
  logs: string;
  services?: string;
  notice?: string;
  ok: boolean;
  steps: StepResult[];
}
