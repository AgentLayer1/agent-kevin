import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireCheckoutLock } from './lock';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gate-lock-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const deadPid = (): number => {
  const child = Bun.spawnSync(['/usr/bin/true']);
  return child.pid;
};

describe('acquireCheckoutLock', () => {
  test('a second gate on the same checkout is refused while the first holds it', () => {
    const first = acquireCheckoutLock('/dev/acme', 'run-1', { dir, ownerStartedAt: '' });

    expect(() => acquireCheckoutLock('/dev/acme', 'run-1', { dir, ownerStartedAt: '' })).toThrow(
      /Another gate is running on \/dev\/acme/
    );
    first.release();
  });

  test('different checkouts gate in parallel', () => {
    const first = acquireCheckoutLock('/dev/acme', 'run-1', { dir, ownerStartedAt: '' });
    const second = acquireCheckoutLock('/dev/acme-feature', 'run-2', { dir, ownerStartedAt: '' });

    expect(readdirSync(dir)).toHaveLength(2);
    first.release();
    second.release();
  });

  test('released, the checkout can be gated again', () => {
    acquireCheckoutLock('/dev/acme', 'run-1', { dir, ownerStartedAt: '' }).release();

    expect(() => acquireCheckoutLock('/dev/acme', 'run-1', { dir, ownerStartedAt: '' }).release()).not.toThrow();
  });

  test("a lock whose owning server is gone is reclaimed, and a group that can't be proven a gate's is left alone", () => {
    const held = acquireCheckoutLock('/dev/acme', 'run-1', { dir, ownerStartedAt: '' });
    const [file] = readdirSync(dir);
    const record = JSON.parse(readFileSync(join(dir, file ?? ''), 'utf8')) as Record<string, unknown>;
    const unrelated = spawn('/bin/sleep', ['30'], { detached: true, stdio: 'ignore' });
    writeFileSync(
      join(dir, file ?? ''),
      JSON.stringify({ ...record, ownerPid: deadPid(), pgid: unrelated.pid, runId: 'not-this-group' })
    );

    const reclaimed = acquireCheckoutLock('/dev/acme', 'run-1', { dir, ownerStartedAt: '' });

    expect(reclaimed.notice).toContain('left alone');
    expect(unrelated.exitCode).toBeNull();
    unrelated.kill('SIGKILL');
    reclaimed.release();
    held.release();
  });
});
