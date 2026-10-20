import { describe, expect, test } from 'bun:test';
import { issueCreateArgs, issueEditArgs } from './github-issues';

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
