import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groupAlive, isAlive, stopGroup } from '@/shared/process-group';

interface LockRecord {
  checkout: string;
  ownerPid: number;
  /** Tells a live owner from a reused pid: a pid alone can't. */
  ownerStartedAt: string;
  startedAt: string;
  pgid?: number;
  /** `AGENT_GATE_RUN` in the group's environment: proof a recorded pgid is still this gate's, not a reused one. */
  runId: string;
}

/**
 * One gate per checkout, machine-wide: every session and home on this machine shares the lock directory,
 * because they share the checkout's build outputs. A lock whose owner is gone is reclaimed; the process group
 * it left is stopped only when it still carries that run's marker.
 */
export const acquireCheckoutLock = (
  checkout: string,
  runId: string,
  { dir = defaultLockDir(), ownerStartedAt = processStartedAt(process.pid) } = {}
): CheckoutLock => {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${createHash('sha256').update(checkout).digest('hex').slice(0, 16)}.json`);
  const record: LockRecord = {
    checkout,
    ownerPid: process.pid,
    ownerStartedAt,
    startedAt: new Date().toISOString(),
    runId
  };

  const claim = (): boolean => {
    try {
      writeFileSync(file, JSON.stringify(record), { flag: 'wx' });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return false;
      }
      throw error;
    }
  };

  let notice: string | undefined;
  if (!claim()) {
    const held = readLock(file);
    if (held && ownerAlive(held)) {
      throw new Error(
        `Another gate is running on ${checkout} (server pid ${held.ownerPid}, since ${held.startedAt}). One gate per checkout: wait for it, or use another worktree.`
      );
    }
    const pgid = held?.pgid;
    if (held && pgid && groupAlive(pgid)) {
      if (held.runId && isGateGroup(pgid, held.runId)) {
        stopGroup(pgid, 2_000);
        notice = `Stopped the leftover process group ${pgid} from a gate whose session ended (${held.startedAt}).`;
      } else {
        notice = `A gate whose session ended left group ${pgid} recorded, but it doesn't carry that run's marker, so it was left alone.`;
      }
    }
    rmSync(file, { force: true });
    if (!claim()) {
      throw new Error(`Another gate claimed ${checkout} at the same moment; try again.`);
    }
  }

  return {
    notice,
    setGroup: (pgid) => writeFileSync(file, JSON.stringify({ ...record, pgid })),
    release: () => {
      const held = readLock(file);
      if (held?.ownerPid === process.pid) {
        rmSync(file, { force: true });
      }
    }
  };
};

const processStartedAt = (pid: number): string => {
  try {
    const result = Bun.spawnSync(['/bin/ps', '-o', 'lstart=', '-p', String(pid)]);
    return result.exitCode === 0 ? result.stdout.toString().trim() : '';
  } catch {
    return '';
  }
};

const isGateGroup = (pgid: number, runId: string): boolean => {
  try {
    const result = Bun.spawnSync(['/bin/ps', '-E', '-ww', '-o', 'command=', '-g', String(pgid)]);
    return result.exitCode === 0 && result.stdout.toString().includes(`AGENT_GATE_RUN=${runId}`);
  } catch {
    return false;
  }
};

const ownerAlive = (held: LockRecord): boolean => {
  if (!isAlive(held.ownerPid)) {
    return false;
  }
  const startedAt = processStartedAt(held.ownerPid);
  return !held.ownerStartedAt || !startedAt || startedAt === held.ownerStartedAt;
};

const readLock = (file: string): LockRecord | undefined => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LockRecord;
  } catch {
    return undefined;
  }
};

const defaultLockDir = (): string => join(tmpdir(), 'agent-gate-locks');

interface CheckoutLock {
  notice?: string;
  setGroup: (pgid: number) => void;
  release: () => void;
}
