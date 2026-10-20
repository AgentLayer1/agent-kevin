import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv } from './github';
import { attachArgs, issueCreateArgs, issueEditArgs } from './github-issues';

describe('issueCreateArgs', () => {
  test('repeats --label per label and adds the milestone when given', () => {
    expect(issueCreateArgs({ repo: 'acme/app', title: 'Export broken', body: 'Steps', labels: ['triage', 'needs info'], milestone: '2.1.0' })).toEqual([
      'issue', 'create', '-R', 'acme/app', '--title', 'Export broken', '--body', 'Steps',
      '--label', 'triage', '--label', 'needs info', '--milestone', '2.1.0'
    ]);
  });
});

describe('issueEditArgs', () => {
  test('swaps labels in one call', () => {
    expect(issueEditArgs({ repo: 'acme/app', number: 57, addLabels: ['accepted'], removeLabels: ['triage'] })).toEqual([
      'issue', 'edit', '57', '-R', 'acme/app', '--add-label', 'accepted', '--remove-label', 'triage'
    ]);
  });

  test('an empty milestone clears it', () => {
    expect(issueEditArgs({ repo: 'acme/app', number: 57, milestone: '' })).toContain('--remove-milestone');
  });

  test('refuses a call that changes nothing', () => {
    expect(() => issueEditArgs({ repo: 'acme/app', number: 57 })).toThrow(/Nothing to change/);
  });
});

describe('attachArgs', () => {
  test('passes images through and refuses what GitHub rejects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'attach-'));
    const shot = join(dir, 'watch.png');
    writeFileSync(shot, 'png');
    expect(attachArgs([shot])).toEqual(['--attach', shot]);
    expect(() => attachArgs([join(dir, 'acme.log')])).toThrow(/only/);
    expect(() => attachArgs([join(dir, 'a#b.png')])).toThrow(/alt text/);
    expect(() => attachArgs([join(dir, 'missing.png')])).toThrow(/no such file/);
  });
});

describe('childEnv', () => {
  const saved = process.env.GITHUB_TOKEN;
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = saved;
    }
  });

  test('an issue write never inherits the read-only token', () => {
    process.env.GITHUB_TOKEN = 'read-only';
    expect(childEnv(undefined).GITHUB_TOKEN).toBeUndefined();
    expect(childEnv('issues').GITHUB_TOKEN).toBe('issues');
  });
});
