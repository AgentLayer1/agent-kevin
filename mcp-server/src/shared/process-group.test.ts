import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groupAlive, runGroup } from './process-group';

describe('runGroup', () => {
  test('a timeout takes down the whole group, grandchildren included', async () => {
    let pgid = 0;
    const result = await runGroup(['/bin/sh', '-c', 'sleep 30 & sleep 30 & wait'], {
      cwd: tmpdir(),
      timeoutMs: 300,
      onStart: (started) => {
        pgid = started;
      }
    });

    expect(result.timedOut).toBe(true);
    expect(pgid).toBeGreaterThan(0);
    expect(groupAlive(pgid)).toBe(false);
  });

  test('a leader that exits normally leaves no background child behind', async () => {
    let pgid = 0;
    const result = await runGroup(['/bin/sh', '-c', 'sleep 30 & echo started'], {
      cwd: tmpdir(),
      timeoutMs: 5_000,
      onStart: (started) => {
        pgid = started;
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('started');
    expect(groupAlive(pgid)).toBe(false);
  });

  test('cancelling the call stops the group', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await runGroup(['/bin/sleep', '30'], {
      cwd: tmpdir(),
      timeoutMs: 10_000,
      signal: controller.signal
    });

    expect(result.cancelled).toBe(true);
  });

  test('a call cancelled before it starts stops the group at once', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runGroup(['/bin/sleep', '30'], {
      cwd: tmpdir(),
      timeoutMs: 10_000,
      signal: controller.signal
    });

    expect(result.cancelled).toBe(true);
    expect(result.seconds).toBeLessThan(5);
  });

  test('the child sees only the environment it is given', async () => {
    process.env.PROCESS_GROUP_TEST_SECRET = 'leak';
    const result = await runGroup(['/usr/bin/env'], {
      cwd: tmpdir(),
      env: { PATH: '/usr/bin:/bin' },
      timeoutMs: 5_000
    });
    delete process.env.PROCESS_GROUP_TEST_SECRET;

    expect(result.stdout).not.toContain('leak');
  });

  test('output goes to the log file when one is given', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'process-group-test-'));
    const logFile = join(dir, 'step.log');
    await runGroup(['/bin/sh', '-c', 'echo out; echo err >&2'], { cwd: dir, logFile, timeoutMs: 5_000 });

    expect(readFileSync(logFile, 'utf8')).toContain('out');
    expect(readFileSync(logFile, 'utf8')).toContain('err');
    rmSync(dir, { recursive: true, force: true });
  });
});
