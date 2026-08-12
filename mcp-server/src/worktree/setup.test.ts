import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listWorktrees, type WorktreeStatus } from './setup';

/**
 * Verdict matrix for `listWorktrees`, against a real temp repo with a bare origin: one worktree
 * per lifecycle state (merged, squash-merged, dirty, unpushed, pushed-in-review, missing dir).
 */
describe('listWorktrees', () => {
  let root: string;
  let repo: string;

  const run = (cwd: string, args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  const commitFile = (cwd: string, file: string, content: string, message: string) => {
    writeFileSync(join(cwd, file), content);
    run(cwd, ['add', '.']);
    run(cwd, ['commit', '-m', message]);
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'kevin-worktree-list-'));
    const origin = join(root, 'origin.git');
    execFileSync('git', ['init', '--bare', origin], { encoding: 'utf8' });

    repo = join(root, 'repo');
    execFileSync('git', ['init', '-b', 'main', repo], { encoding: 'utf8' });
    run(repo, ['config', 'user.email', 'test@example.com']);
    run(repo, ['config', 'user.name', 'Test']);
    run(repo, ['config', 'commit.gpgsign', 'false']);
    commitFile(repo, 'README.md', 'hello\n', 'initial');
    run(repo, ['remote', 'add', 'origin', origin]);
    run(repo, ['push', '-u', 'origin', 'main']);

    // merged: branch commit landed in main via a regular merge.
    const merged = join(root, 'repo-merged');
    run(repo, ['worktree', 'add', merged, '-b', 'feat-merged']);
    commitFile(merged, 'merged.txt', 'merged\n', 'merged work');
    run(repo, ['merge', '--no-ff', 'feat-merged', '-m', 'merge feat-merged']);

    // squash-merged: same patch landed in main as a different commit.
    const squash = join(root, 'repo-squash');
    run(repo, ['worktree', 'add', squash, '-b', 'feat-squash']);
    commitFile(squash, 'squash.txt', 'squash\n', 'squash work');
    run(repo, ['merge', '--squash', 'feat-squash']);
    run(repo, ['commit', '-m', 'squash feat-squash']);
    run(repo, ['push', 'origin', 'main']);

    // dirty: an untracked file blocks everything else.
    const dirty = join(root, 'repo-dirty');
    run(repo, ['worktree', 'add', dirty, '-b', 'feat-dirty']);
    writeFileSync(join(dirty, 'wip.txt'), 'wip\n');

    // unpushed: a commit on no remote, not merged.
    const unpushed = join(root, 'repo-unpushed');
    run(repo, ['worktree', 'add', unpushed, '-b', 'feat-unpushed']);
    commitFile(unpushed, 'unpushed.txt', 'unpushed\n', 'unpushed work');

    // pushed-unmerged: safe on the remote, awaiting merge.
    const review = join(root, 'repo-review');
    run(repo, ['worktree', 'add', review, '-b', 'feat-review']);
    commitFile(review, 'review.txt', 'review\n', 'review work');
    run(review, ['push', '-u', 'origin', 'feat-review']);

    // missing: registered in git but the directory is gone.
    const gone = join(root, 'repo-gone');
    run(repo, ['worktree', 'add', gone, '-b', 'feat-gone']);
    rmSync(gone, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const byBranch = (result: ReturnType<typeof listWorktrees>, branch: string): WorktreeStatus => {
    const entry = result.worktrees.find((worktree) => worktree.branch === branch);
    if (!entry) {
      throw new Error(`No worktree for branch ${branch}`);
    }
    return entry;
  };

  test('measures against the remote-tracking base and flags the main checkout', () => {
    const result = listWorktrees({ repoPath: repo });
    expect(result.baseRef).toBe('origin/main');
    expect(result.mainCheckout).toBe(run(repo, ['rev-parse', '--show-toplevel']));
    expect(byBranch(result, 'main').verdict).toBe('main');
    expect(result.worktrees).toHaveLength(7);
  });

  test('a regularly merged branch is deletable', () => {
    const entry = byBranch(listWorktrees({ repoPath: repo }), 'feat-merged');
    expect(entry.merged).toBe(true);
    expect(entry.verdict).toBe('deletable');
  });

  test('a squash-merged branch is deletable via cherry equivalence', () => {
    const entry = byBranch(listWorktrees({ repoPath: repo }), 'feat-squash');
    expect(entry.merged).toBe(false);
    expect(entry.squashMerged).toBe(true);
    expect(entry.verdict).toBe('deletable');
    // The raw commit is on no remote — remove_worktree would still gate on force.
    expect(entry.unpushed).toBe(1);
  });

  test('uncommitted changes outrank every other state', () => {
    const entry = byBranch(listWorktrees({ repoPath: repo }), 'feat-dirty');
    expect(entry.uncommitted).toBe(1);
    expect(entry.verdict).toBe('uncommitted');
  });

  test('committed-but-unpushed work is flagged', () => {
    const entry = byBranch(listWorktrees({ repoPath: repo }), 'feat-unpushed');
    expect(entry.unpushed).toBe(1);
    expect(entry.aheadOfBase).toBe(1);
    expect(entry.verdict).toBe('unpushed');
  });

  test('pushed but unmerged reads as in review', () => {
    const entry = byBranch(listWorktrees({ repoPath: repo }), 'feat-review');
    expect(entry.unpushed).toBe(0);
    expect(entry.merged).toBe(false);
    expect(entry.verdict).toBe('pushed-unmerged');
  });

  test('a registered worktree whose directory is gone reads as missing', () => {
    const entry = byBranch(listWorktrees({ repoPath: repo }), 'feat-gone');
    expect(entry.missing).toBe(true);
    expect(entry.verdict).toBe('missing');
  });

  test('reports last-commit recency', () => {
    const entry = byBranch(listWorktrees({ repoPath: repo }), 'feat-merged');
    expect(entry.lastCommit).not.toBeNull();
    expect(entry.lastCommitDays).toBe(0);
  });

  test('works when pointed at a worktree instead of the main checkout', () => {
    const result = listWorktrees({ repoPath: join(root, 'repo-merged') });
    expect(result.mainCheckout).toBe(run(repo, ['rev-parse', '--show-toplevel']));
    expect(result.worktrees).toHaveLength(7);
  });
});
