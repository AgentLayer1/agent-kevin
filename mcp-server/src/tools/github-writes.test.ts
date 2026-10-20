import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv } from './github';
import { attachArgs, issueCreateArgs, issueEditArgs, prEditArgs } from './github-writes';

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

  test('replaces the description alone', () => {
    expect(issueEditArgs({ repo: 'acme/app', number: 57, body: 'Steps to reproduce' })).toEqual([
      'issue', 'edit', '57', '-R', 'acme/app', '--body', 'Steps to reproduce'
    ]);
  });

  test('an empty milestone clears it', () => {
    expect(issueEditArgs({ repo: 'acme/app', number: 57, milestone: '' })).toContain('--remove-milestone');
  });

  test('refuses a call that changes nothing', () => {
    expect(() => issueEditArgs({ repo: 'acme/app', number: 57 })).toThrow(/Nothing to change/);
  });
});

describe('prEditArgs', () => {
  test('sets only what was given', () => {
    expect(prEditArgs({ repo: 'acme/app', number: 9, body: 'New description' })).toEqual([
      'pr', 'edit', '9', '-R', 'acme/app', '--body', 'New description'
    ]);
  });

  test('refuses a call that changes nothing', () => {
    expect(() => prEditArgs({ repo: 'acme/app', number: 9 })).toThrow(/Nothing to change/);
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
  const keys = ['GITHUB_TOKEN', 'GITHUB_TOKEN_ACME', 'GH_TOKEN'] as const;
  const saved = keys.map((key) => [key, process.env[key]] as const);
  afterEach(() => {
    saved.forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  test('a call carries only the token it resolved', () => {
    process.env.GITHUB_TOKEN = 'catch-all';
    process.env.GITHUB_TOKEN_ACME = 'acme-only';
    process.env.GH_TOKEN = 'login';
    const child = childEnv('acme-only');
    expect(child.GITHUB_TOKEN).toBe('acme-only');
    expect(child.GITHUB_TOKEN_ACME).toBeUndefined();
    expect(child.GH_TOKEN).toBeUndefined();
    expect(childEnv(undefined).GITHUB_TOKEN).toBeUndefined();
  });
});
