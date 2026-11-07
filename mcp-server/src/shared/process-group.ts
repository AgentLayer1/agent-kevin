import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { constants } from 'node:os';

const WINDOWS = process.platform === 'win32';

interface GroupOptions {
  cwd: string;
  /** The child's whole environment; omitted, it inherits the server's. */
  env?: NodeJS.ProcessEnv;
  /** Append stdout and stderr here instead of capturing them. */
  logFile?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Run through the shell, for a Windows `.cmd` shim (`pnpm.cmd`); never with an argument that isn't ours. */
  shell?: boolean;
  /** Called with the group id as soon as the leader starts (never on Windows, which has no groups). */
  onStart?: (pgid: number) => void;
}

/**
 * Runs `argv` as the leader of its own process group and takes the whole group down when it ends, times
 * out, is cancelled, or the server exits, so no worker it started outlives the call.
 */
export const runGroup = async (
  argv: string[],
  { cwd, env, logFile, timeoutMs, signal, shell, onStart }: GroupOptions
): Promise<GroupResult> => {
  const [command, ...args] = argv;
  if (!command) {
    throw new Error('runGroup needs a command');
  }

  const started = performance.now();
  const logFd = logFile ? openSync(logFile, 'a') : undefined;
  const child = spawn(command, args, {
    cwd,
    env,
    shell,
    detached: !WINDOWS,
    stdio: ['ignore', logFd ?? 'pipe', logFd ?? 'pipe']
  });

  const chunks: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] };
  child.stdout?.on('data', (chunk: Buffer) => chunks.stdout.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => chunks.stderr.push(chunk));
  // TODO(windows): no process groups there, so a timeout or cancel stops the direct child only.
  const pgid = WINDOWS ? undefined : child.pid;
  let stoppedBy: 'timeout' | 'cancel' | undefined;
  const stopFor = (reason: 'timeout' | 'cancel') => () => {
    stoppedBy ??= reason;
    if (pgid) {
      stopGroup(pgid);
    } else {
      child.kill();
    }
  };
  const timer = setTimeout(stopFor('timeout'), timeoutMs);
  const onAbort = stopFor('cancel');
  signal?.addEventListener('abort', onAbort, { once: true });
  if (pgid) {
    trackGroup(pgid);
    onStart?.(pgid);
  }
  if (signal?.aborted) {
    onAbort();
  }

  const closed = new Promise<void>((resolveClose) => child.once('close', () => resolveClose()));

  try {
    const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('exit', (code) => resolveExit(code));
    });
    if (pgid) {
      // The leader is gone; anything it left behind in its group goes with it, which also lets the pipes drain.
      signalGroup(pgid, 'SIGKILL');
    }
    await closed;
    return {
      exitCode,
      timedOut: stoppedBy === 'timeout',
      cancelled: stoppedBy === 'cancel',
      seconds: Math.round((performance.now() - started) / 100) / 10,
      stdout: Buffer.concat(chunks.stdout).toString(),
      stderr: Buffer.concat(chunks.stderr).toString()
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (pgid) {
      activeGroups.delete(pgid);
    }
    if (logFd !== undefined) {
      closeSync(logFd);
    }
  }
};

/**
 * SIGTERM to the whole group, then SIGKILL to whatever is still there after a grace period.
 */
export const stopGroup = (pgid: number | undefined, graceMs = 10_000): void => {
  if (!pgid) {
    return;
  }
  signalGroup(pgid, 'SIGTERM');
  setTimeout(() => signalGroup(pgid, 'SIGKILL'), graceMs).unref();
};

/**
 * Whether a process (or, for a negative id, a process group) is alive; `EPERM` means alive but not ours to signal.
 */
export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export const groupAlive = (pgid: number): boolean => isAlive(-pgid);

const signalGroup = (pgid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pgid, signal);
  } catch {
    // kill(2) fails once the group is gone, and then there is nothing left to stop.
  }
};

export const activeGroups = new Set<number>();
let exitHooksInstalled = false;

const trackGroup = (pgid: number): void => {
  activeGroups.add(pgid);
  if (exitHooksInstalled) {
    return;
  }
  exitHooksInstalled = true;
  const killAll = () => activeGroups.forEach((group) => signalGroup(group, 'SIGKILL'));
  process.once('exit', killAll);
  // The session closing its end of stdio is how a stdio MCP server learns it is done.
  process.stdin.once('end', killAll);
  (['SIGTERM', 'SIGINT', 'SIGHUP'] as const).forEach((name) =>
    process.once(name, () => {
      killAll();
      process.exit(128 + constants.signals[name]);
    })
  );
};

interface GroupResult {
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  seconds: number;
  stdout: string;
  stderr: string;
}
