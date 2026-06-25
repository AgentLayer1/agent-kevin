import { describe, expect, test } from 'bun:test';
import { parseGitHubRemote } from './github';

describe('parseGitHubRemote', () => {
  test('SSH remote', () => {
    expect(parseGitHubRemote('git@github.com:AgentLayer1/agent-kevin.git')).toBe('AgentLayer1/agent-kevin');
  });

  test('HTTPS remote with .git', () => {
    expect(parseGitHubRemote('https://github.com/owner/repo.git')).toBe('owner/repo');
  });

  test('HTTPS remote without .git, trailing slash', () => {
    expect(parseGitHubRemote('https://github.com/owner/repo/')).toBe('owner/repo');
  });

  test('ssh:// scheme', () => {
    expect(parseGitHubRemote('ssh://git@github.com/owner/repo.git')).toBe('owner/repo');
  });

  test('repo names with dots and hyphens', () => {
    expect(parseGitHubRemote('git@github.com:my-org/my.repo.js.git')).toBe('my-org/my.repo.js');
  });

  test('non-GitHub host returns null', () => {
    expect(parseGitHubRemote('git@gitlab.com:owner/repo.git')).toBeNull();
  });

  test('garbage returns null', () => {
    expect(parseGitHubRemote('not a url')).toBeNull();
  });
});
