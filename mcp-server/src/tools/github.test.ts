import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFetchFailure, fastForwardBranch, parseGitHubRemote } from './github';

describe('parseGitHubRemote', () => {
  test('SSH remote', () => {
    expect(parseGitHubRemote('git@github.com:acme/monorepo.git')).toBe('acme/monorepo');
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

/**
 * Guard matrix for `github_fast_forward`. These assert the safety guarantees the sync skill
 * documents — forward-only, never touch a dirty tree, never fight a linked worktree — against
 * real git in scratch repos, because the protections are git's behaviour and not our bookkeeping.
 */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();

const commit = (repo: string, file: string, body: string, message: string): void => {
  writeFileSync(join(repo, file), body);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', message);
};

const root = mkdtempSync(join(tmpdir(), 'gh-ff-'));
const upstream = join(root, 'up.git');
const seed = join(root, 'seed');
const clone = join(root, 'clone');

/** A bare "origin" plus a clone that tracks main + develop, with origin ahead on both. */
const buildFixture = (): void => {
  execFileSync('git', ['init', '-q', '--bare', upstream]);
  execFileSync('git', ['init', '-q', seed]);
  commit(seed, 'f', 'a1\n', 'a1');
  git(seed, 'branch', '-M', 'main');
  git(seed, 'remote', 'add', 'origin', upstream);
  git(seed, 'push', '-q', 'origin', 'main');
  git(seed, 'checkout', '-qb', 'develop');
  commit(seed, 'g', 'd1\n', 'd1');
  git(seed, 'push', '-q', 'origin', 'develop');

  execFileSync('git', ['clone', '-q', upstream, clone]);
  // Materializes the local `develop` ref that firstSyncableBranch requires, then lands on main.
  git(clone, 'checkout', '-q', 'develop');
  git(clone, 'checkout', '-q', 'main');

  git(seed, 'checkout', '-q', 'main');
  commit(seed, 'f', 'a1\na2\n', 'a2');
  git(seed, 'push', '-q', 'origin', 'main');
  git(seed, 'checkout', '-q', 'develop');
  commit(seed, 'g', 'd1\nd2\n', 'd2');
  git(seed, 'push', '-q', 'origin', 'develop');

  git(clone, 'fetch', '-q', '--prune', upstream, '+refs/heads/*:refs/remotes/origin/*');
};

beforeAll(buildFixture);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const clean = { current: 'main', dirty: false };

describe('fastForwardBranch', () => {
  test('advances a branch that is behind and not checked out anywhere', async () => {
    const report = await fastForwardBranch(clone, { slot: 'integration', branch: 'develop' }, clean);
    expect(report.status).toBe('UPDATED');
    expect(report.behind).toBe(1);
    expect(git(clone, 'rev-parse', 'develop')).toBe(git(clone, 'rev-parse', 'refs/remotes/origin/develop'));
  });

  test('reports an already-current branch without touching it', async () => {
    const report = await fastForwardBranch(clone, { slot: 'integration', branch: 'develop' }, clean);
    expect(report.status).toBe('CURRENT');
    expect(report.behind).toBeUndefined();
  });

  test('refuses a branch held by a linked worktree, leaving its work intact', async () => {
    const held = join(root, 'wt');
    git(clone, 'branch', '-f', 'probe', 'HEAD');
    git(clone, 'worktree', 'add', '-q', held, 'probe');
    const scratch = join(held, 'uncommitted.txt');
    writeFileSync(scratch, 'work in progress\n');
    const before = git(clone, 'rev-parse', 'probe');

    const report = await fastForwardBranch(clone, { slot: 'primary', branch: 'probe' }, clean);

    expect(report.status).toBe('CLAIMED_BY_WORKTREE');
    expect(git(clone, 'rev-parse', 'probe')).toBe(before);
    expect(git(held, 'rev-parse', 'HEAD')).toBe(before);
    expect(Bun.file(scratch).size).toBeGreaterThan(0);
    git(clone, 'worktree', 'remove', '--force', held);
  });

  test('refuses a diverged branch instead of rewriting local commits', async () => {
    git(clone, 'checkout', '-q', 'develop');
    commit(clone, 'local-only', 'mine\n', 'local-only');
    const before = git(clone, 'rev-parse', 'develop');
    git(clone, 'checkout', '-q', 'main');
    git(clone, 'update-ref', 'refs/remotes/origin/develop', git(clone, 'rev-parse', 'refs/remotes/origin/main'));

    const report = await fastForwardBranch(clone, { slot: 'integration', branch: 'develop' }, clean);

    expect(report.status).toBe('NOT_FAST_FORWARD');
    expect(git(clone, 'rev-parse', 'develop')).toBe(before);
  });

  test('fast-forwards the checked-out branch when the tree is clean', async () => {
    const report = await fastForwardBranch(clone, { slot: 'primary', branch: 'main' }, clean);
    expect(report.status).toBe('UPDATED');
    expect(git(clone, 'rev-parse', 'main')).toBe(git(clone, 'rev-parse', 'refs/remotes/origin/main'));
  });

  test('skips the checked-out branch when the tree is dirty', async () => {
    git(clone, 'update-ref', 'refs/heads/main', git(clone, 'rev-parse', 'main^'));
    git(clone, 'reset', '-q', '--hard', 'main');
    writeFileSync(join(clone, 'f'), 'uncommitted edit\n');
    const before = git(clone, 'rev-parse', 'main');

    const report = await fastForwardBranch(
      clone,
      { slot: 'primary', branch: 'main' },
      { current: 'main', dirty: true }
    );

    expect(report.status).toBe('SKIPPED_DIRTY');
    expect(report.behind).toBe(1);
    expect(git(clone, 'rev-parse', 'main')).toBe(before);
    expect(await Bun.file(join(clone, 'f')).text()).toBe('uncommitted edit\n');
  });
});

describe('classifyFetchFailure', () => {
  test('a repo the token cannot see reads as NO_ACCESS', () => {
    expect(classifyFetchFailure("remote: Repository not found.\nfatal: repository 'https://…' not found")).toBe(
      'NO_ACCESS'
    );
  });

  // Verbatim from a live run with a real PAT the org had not yet approved: GitHub answers 403,
  // not 404, so this must not be mistaken for a bad credential.
  test('an unapproved or under-scoped PAT reads as NO_ACCESS, not AUTH', () => {
    expect(
      classifyFetchFailure(
        "fatal: unable to access 'https://github.com/acme/repo.git/': The requested URL returned error: 403"
      )
    ).toBe('NO_ACCESS');
  });

  test('a bad token reads as AUTH', () => {
    expect(
      classifyFetchFailure(
        'remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed'
      )
    ).toBe('AUTH');
  });

  test('no egress reads as NETWORK', () => {
    expect(classifyFetchFailure('fatal: unable to access …: Could not resolve host: github.com')).toBe('NETWORK');
  });

  test('anything unrecognised stays UNKNOWN rather than guessing', () => {
    expect(classifyFetchFailure('fatal: early EOF')).toBe('UNKNOWN');
  });
});
