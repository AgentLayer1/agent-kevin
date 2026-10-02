import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentKeyName, runtimeDirName } from '../../../mcp-server/src/shared/naming';
import { selfReviewDue } from './self-review-due';

const TODAY = '2026-10-31';
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('selfReviewDue', () => {
  test('the brain pass is monthly, and a never-reviewed home waits until its oldest session is a month old', () => {
    expect(selfReviewDue({ brainLastRun: '2026-10-01' }, TODAY, null, '2026-01-01')?.invoke).toBe('self-review brain');
    expect(selfReviewDue({ brainLastRun: '2026-10-02' }, TODAY, null, '2026-01-01')).toBeNull();
    expect(selfReviewDue({}, TODAY, null, '2026-10-01')?.invoke).toBe('self-review brain');
    expect(selfReviewDue({}, TODAY, null, '2026-10-02')).toBeNull();
    expect(selfReviewDue({}, TODAY, null, null)).toBeNull();
  });

  test('the rules pass keeps its feedback rule, and both due runs the whole review', () => {
    expect(selfReviewDue({ brainLastRun: TODAY, lastRun: '2026-10-17' }, TODAY, '2026-10-20', null)?.invoke).toBe(
      'self-review rules'
    );
    expect(selfReviewDue({ brainLastRun: TODAY, lastRun: '2026-10-18' }, TODAY, '2026-10-20', null)).toBeNull();
    expect(selfReviewDue({ brainLastRun: '2026-09-01', lastRun: '2026-09-01' }, TODAY, null, null)?.invoke).toBe(
      'self-review'
    );
  });

  test('tomorrow holds it off for a day, a skip for a month, and two skips in a row show in the label', () => {
    const overdue = { brainLastRun: '2026-08-01' };
    expect(selfReviewDue({ ...overdue, snoozeUntil: '2026-11-01' }, TODAY, null, null)).toBeNull();
    expect(selfReviewDue({ ...overdue, snoozeUntil: TODAY }, TODAY, null, null)).not.toBeNull();
    expect(selfReviewDue({ ...overdue, skippedOn: '2026-10-02' }, TODAY, null, null)).toBeNull();
    expect(selfReviewDue({ ...overdue, skippedOn: '2026-10-01', skips: 2 }, TODAY, null, null)?.label).toBe(
      'Self-review (brain pass), skipped 2 times in a row'
    );
  });
});

describe('review-defer', () => {
  const run = (choice: string, seed = JSON.stringify({ lastRun: '2026-09-23', skips: 1 })) => {
    const root = mkdtempSync(join(tmpdir(), 'review-defer-'));
    dirs.push(root);
    mkdirSync(join(root, runtimeDirName()), { recursive: true });
    writeFileSync(join(root, runtimeDirName(), 'version.json'), '{}');
    writeFileSync(join(root, runtimeDirName(), 'review.json'), seed);
    const proc = spawnSync(process.execPath, [join(import.meta.dir, 'review-defer.ts'), choice, '--today', TODAY], {
      env: { ...process.env, [agentKeyName('HOME')]: root }
    });
    return {
      status: proc.status,
      review: readFileSync(join(root, runtimeDirName(), 'review.json'), 'utf8')
    };
  };

  test('tomorrow snoozes to the next day and skip counts, both keeping the other keys', () => {
    const parsed = (result: { status: number | null; review: string }) => ({
      ...result,
      review: JSON.parse(result.review)
    });
    expect(parsed(run('tomorrow'))).toEqual({
      status: 0,
      review: { lastRun: '2026-09-23', skips: 1, snoozeUntil: '2026-11-01' }
    });
    expect(parsed(run('skip'))).toEqual({ status: 0, review: { lastRun: '2026-09-23', skips: 2, skippedOn: TODAY } });
  });

  test('a damaged watermark is refused and left exactly as it was', () => {
    expect(run('tomorrow', '{ "lastRun": ')).toEqual({ status: 1, review: '{ "lastRun": ' });
  });
});
