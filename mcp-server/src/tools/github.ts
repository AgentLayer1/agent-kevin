/**
 * GitHub tools — read-only `gh` CLI wrappers, plus `github_fast_forward`, which uses the
 * same PAT to fast-forward local checkouts (read-only against GitHub; the only mutations
 * are forward-only local ref updates).
 *
 * Why an MCP tool and not Bash: under the Claude Code seatbelt `gh` dies during TLS
 * setup (its macOS build verifies certs via Security.framework/keychain, which the
 * sandbox blocks — OSStatus -26276). The MCP server runs OUTSIDE that sandbox, so the
 * same `gh` invocation works here. Auth is a fine-grained, read-only PAT in
 * `.kevin/secrets/.env` as `GITHUB_TOKEN` (gh honors it and skips the keychain).
 *
 * Repo resolution when a call omits `repo`: derive `owner/repo` from the `origin` remote
 * of `KEVIN_CODE_PATH`, then the first `KEVIN_GIT_REPOS` entry, then error asking for one.
 * An explicit `owner/repo` always wins. Mirrors how setup-worktree pins its target.
 *
 * Scope is deliberately read-only against GitHub — list/view PRs, diffs, checks, and diagnose
 * failing workflow runs. No write subcommands (comment/create/merge/re-run) are exposed; those
 * leave the machine and stay a maintainer-gated, human-in-terminal activity.
 *
 * GitHub responses cross a trust boundary, so every payload is wrapped with `untrusted()`.
 */
import { configuredRepoPaths } from '@/config';
import { env } from '@/shared/env';
import { log } from '@/shared/log';
import { expandTilde } from '@/shared/paths';
import { defineTool, type ToolDef } from '@/shared/types';
import { untrusted } from '@/shared/untrusted';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Match `owner/repo` out of an SSH or HTTPS GitHub remote URL. */
const GH_REMOTE_RE = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/;

/** gh log/diff output is unbounded; cap text payloads so a giant CI log can't blow up context. */
const DEFAULT_MAX_CHARS = 100_000;

/** Suppress gh's pager, colour, and update checks so stdout is clean, parseable text. */
const childEnv = (token: string): NodeJS.ProcessEnv => ({
  ...process.env,
  GITHUB_TOKEN: token,
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_PAGER: 'cat',
  NO_COLOR: '1',
  CLICOLOR: '0'
});

/** The configured PAT, or a fail-loud error pointing at the pack walk. */
const requireToken = (): string => {
  const token = env('GITHUB_TOKEN');
  if (!token) {
    throw new Error(
      'GITHUB_TOKEN not set. Add a fine-grained, read-only PAT to <HOME>/.kevin/secrets/.env as GITHUB_TOKEN (run /agent-kevin:configure-skills → GitHub pack for the walk).'
    );
  }
  return token;
};

/**
 * Run a `gh` subcommand (argv, no shell) outside the sandbox and return stdout.
 * Throws a fail-loud error when the token is missing or `gh` is not installed.
 *
 * `allowNonZero`: some gh commands use the exit code as a status signal while still
 * printing valid output (e.g. `gh pr checks` exits 8 on pending / 1 on failure). For
 * those, a non-zero exit with stdout present is a normal result, not an error.
 */
const runGh = async (args: string[], { allowNonZero = false } = {}): Promise<string> => {
  const token = requireToken();
  try {
    const { stdout } = await execFileAsync('gh', args, { env: childEnv(token), maxBuffer: 64 * 1024 * 1024 });
    log.info(`gh ${args.slice(0, 3).join(' ')} → ${stdout.length}b`);
    return stdout;
  } catch (error) {
    const failure = error as { code?: string; stdout?: string; stderr?: string; message?: string };
    if (failure.code === 'ENOENT') {
      throw new Error('gh CLI not found on PATH. Install it: `brew install gh`.');
    }
    if (allowNonZero && failure.stdout) {
      return failure.stdout;
    }
    throw new Error(`gh ${args[0]} failed: ${(failure.stderr || failure.message || String(error)).trim()}`);
  }
};

/** `owner/repo` out of an SSH or HTTPS GitHub remote URL, or null if it isn't one. */
export const parseGitHubRemote = (url: string): string | null => {
  const match = url.trim().match(GH_REMOTE_RE);
  const slug = match ? `${match[1]}/${match[2]}` : '';
  return REPO_RE.test(slug) ? slug : null;
};

/** `owner/repo` from an absolute checkout's `origin` remote, or null if it isn't a GitHub repo. */
const repoSlugFromPath = async (path: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync('git', ['-C', path, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8'
    });
    return parseGitHubRemote(stdout);
  } catch {
    return null;
  }
};

/** KEVIN_CODE_PATH's repo → first KEVIN_GIT_REPOS entry's repo → throw (caller must pass `repo`). */
const resolveDefaultRepo = async (): Promise<string> => {
  for (const path of configuredRepoPaths()) {
    const slug = await repoSlugFromPath(path);
    if (slug) {
      return slug;
    }
  }
  throw new Error(
    'No repo given and none resolvable from KEVIN_CODE_PATH / KEVIN_GIT_REPOS (need a GitHub `origin` remote). Pass repo as "owner/repo".'
  );
};

/**
 * Resolve the target repo for a call. Guards the token FIRST, so a missing token reports
 * before any repo-resolution I/O. An explicit `owner/repo` wins; otherwise fall back to
 * the configured codebase. Every handler awaits this as its first step.
 */
const resolveRepo = async (repo: string | undefined): Promise<string> => {
  requireToken();
  if (repo) {
    if (!REPO_RE.test(repo)) {
      throw new Error(`Invalid repo (expected OWNER/REPO): ${repo}`);
    }
    return repo;
  }
  return resolveDefaultRepo();
};

/** Run a `--json` gh command (args already include `-R <repo>`) and return the parsed value wrapped as untrusted. */
const ghJson = async (label: string, args: string[], { allowNonZero = false } = {}): Promise<string> => {
  const stdout = await runGh(args, { allowNonZero });
  return untrusted(label, JSON.stringify(JSON.parse(stdout), null, 2));
};

/** Truncate text payloads (diffs, logs) to a character budget, flagging when clipped. */
const clip = (text: string, maxChars: number): string =>
  text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}\n\n…[truncated at ${maxChars} chars — pass a larger maxChars or narrow the request]`;

/**
 * Branch slots kept current, first local match in each pair winning. Two slots rather than
 * four independent branches: a vestigial `master` beside a live `main` must not be touched.
 */
const BRANCH_SLOTS = [
  { slot: 'primary', candidates: ['main', 'master'] },
  { slot: 'integration', candidates: ['develop', 'dev'] }
] as const;

/**
 * Pins fetch auth to the scoped PAT. The empty value resets any inherited helper chain
 * (osxkeychain), so the operator's broader git credential can never be used for this fetch —
 * the read-only token is the only capability in play.
 */
const CREDENTIAL_ARGS = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'] as const;

const RepoSyncStatus = {
  Synced: 'SYNCED',
  NotConfigured: 'NOT_CONFIGURED',
  NotAMainCheckout: 'NOT_A_MAIN_CHECKOUT',
  NotGitHub: 'NOT_GITHUB',
  FetchFailed: 'FETCH_FAILED'
} as const;
type RepoSyncStatus = (typeof RepoSyncStatus)[keyof typeof RepoSyncStatus];

const BranchSyncStatus = {
  Updated: 'UPDATED',
  Current: 'CURRENT',
  Ahead: 'AHEAD',
  SkippedDirty: 'SKIPPED_DIRTY',
  ClaimedByWorktree: 'CLAIMED_BY_WORKTREE',
  NotFastForward: 'NOT_FAST_FORWARD'
} as const;
type BranchSyncStatus = (typeof BranchSyncStatus)[keyof typeof BranchSyncStatus];

const FetchFailureReason = {
  NoAccess: 'NO_ACCESS',
  Auth: 'AUTH',
  Network: 'NETWORK',
  Unknown: 'UNKNOWN'
} as const;
type FetchFailureReason = (typeof FetchFailureReason)[keyof typeof FetchFailureReason];

interface BranchSyncReport {
  readonly branch: string;
  readonly slot: string;
  readonly status: BranchSyncStatus;
  readonly sha: string;
  readonly behind?: number;
}

interface RepoSyncReport {
  readonly repo: string;
  readonly slug?: string;
  readonly status: RepoSyncStatus;
  readonly reason?: FetchFailureReason;
  readonly detail?: string;
  readonly branches: readonly BranchSyncReport[];
}

interface GitRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run git without throwing — this flow reads exit codes as status (128 = worktree-held). */
const runGit = async (cwd: string, args: readonly string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<GitRun> => {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
      maxBuffer: 8 * 1024 * 1024
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: (failure.stderr ?? failure.message ?? '').trim()
    };
  }
};

/** A worktree's `.git` is a file, so a directory means this is the main checkout. */
const isMainCheckout = async (path: string): Promise<boolean> => {
  try {
    return (await stat(join(path, '.git'))).isDirectory();
  } catch {
    return false;
  }
};

/** First candidate present BOTH locally and on origin — a branch is never conjured. */
const firstSyncableBranch = async (path: string, candidates: readonly string[]): Promise<string | null> => {
  for (const branch of candidates) {
    const [local, remote] = await Promise.all([
      runGit(path, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]),
      runGit(path, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`])
    ]);
    if (local.code === 0 && remote.code === 0) {
      return branch;
    }
  }
  return null;
};

/**
 * `AUTH` is only for a credential GitHub rejects outright; everything else that authenticated
 * but wasn't allowed through is `NO_ACCESS`. The split matters because the operator actions
 * differ: re-mint the token vs. add `Contents: Read` / get the org to approve it.
 *
 * Both `NO_ACCESS` shapes are observed, and neither identifies WHY on its own — a fine-grained
 * PAT that the org hasn't approved gets `403`, while a repo the token can't see at all gets
 * `404 Repository not found` (GitHub hides private-repo existence). So the reason says "not
 * authorized for this repo", never which of the two it is.
 */
export const classifyFetchFailure = (stderr: string): FetchFailureReason => {
  if (/could not resolve host|failed to connect|couldn't connect|network is unreachable|timed out/i.test(stderr)) {
    return FetchFailureReason.Network;
  }
  if (/invalid username or token|authentication failed/i.test(stderr)) {
    return FetchFailureReason.Auth;
  }
  if (/not found|\b403\b|permission denied/i.test(stderr)) {
    return FetchFailureReason.NoAccess;
  }
  return FetchFailureReason.Unknown;
};

const revParse = async (path: string, ref: string): Promise<string> =>
  (await runGit(path, ['rev-parse', ref])).stdout.trim();

/**
 * Advance one local branch to its origin counterpart, fast-forward or nothing. Purely local:
 * the checked-out branch goes through `merge --ff-only`, any other through a `fetch .` whose
 * ref update git itself refuses when the branch is diverged (rc 1) or held by a linked
 * worktree (rc 128).
 */
export const fastForwardBranch = async (
  path: string,
  target: { readonly slot: string; readonly branch: string },
  tree: { readonly current: string; readonly dirty: boolean }
): Promise<BranchSyncReport> => {
  const { slot, branch } = target;
  const report = (status: BranchSyncStatus, sha: string, behind?: number): BranchSyncReport => ({
    branch,
    slot,
    status,
    sha: sha.slice(0, 9),
    behind
  });

  const local = await revParse(path, `refs/heads/${branch}`);
  const remote = await revParse(path, `refs/remotes/origin/${branch}`);
  if (local === remote) {
    return report(BranchSyncStatus.Current, local);
  }
  const behind = Number((await runGit(path, ['rev-list', '--count', `${local}..${remote}`])).stdout.trim() || '0');
  // Differing tips with nothing to pull means origin's tip is an ancestor: the operator simply
  // has unpushed commits. Without this exit, `merge --ff-only` reports a phantom UPDATED
  // (rc 0, "Already up to date") and `fetch .` a phantom NOT_FAST_FORWARD.
  if (behind === 0) {
    return report(BranchSyncStatus.Ahead, local);
  }

  if (branch === tree.current) {
    if (tree.dirty) {
      return report(BranchSyncStatus.SkippedDirty, local, behind);
    }
    const merged = await runGit(path, ['merge', '--ff-only', '--quiet', `refs/remotes/origin/${branch}`]);
    return merged.code === 0
      ? report(BranchSyncStatus.Updated, remote, behind)
      : report(BranchSyncStatus.NotFastForward, local);
  }

  const fetched = await runGit(path, ['fetch', '.', `refs/remotes/origin/${branch}:refs/heads/${branch}`]);
  if (fetched.code === 0) {
    return report(BranchSyncStatus.Updated, remote, behind);
  }
  return report(fetched.code === 128 ? BranchSyncStatus.ClaimedByWorktree : BranchSyncStatus.NotFastForward, local);
};

/**
 * One authenticated network call (the `--prune` fetch of every remote head over HTTPS), then
 * local-only ref work. The checkout's own `origin` URL is never read for transport and never
 * rewritten, so an SSH remote keeps working for the operator's own pushes. `path` is already
 * absolute — tilde expansion happens once, at the boundary.
 */
const syncRepo = async (path: string, token: string): Promise<RepoSyncReport> => {
  if (!(await isMainCheckout(path))) {
    return { repo: path, status: RepoSyncStatus.NotAMainCheckout, branches: [] };
  }
  const slug = await repoSlugFromPath(path);
  if (!slug) {
    return { repo: path, status: RepoSyncStatus.NotGitHub, branches: [] };
  }

  const fetched = await runGit(
    path,
    [...CREDENTIAL_ARGS, 'fetch', '--prune', `https://github.com/${slug}.git`, '+refs/heads/*:refs/remotes/origin/*'],
    { GITHUB_TOKEN: token, GIT_TERMINAL_PROMPT: '0' }
  );
  if (fetched.code !== 0) {
    return {
      repo: path,
      slug,
      status: RepoSyncStatus.FetchFailed,
      reason: classifyFetchFailure(fetched.stderr),
      detail: fetched.stderr.split('\n').filter(Boolean).at(-1) ?? '',
      branches: []
    };
  }

  const current = (await runGit(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  const targets = (
    await Promise.all(
      BRANCH_SLOTS.map(async ({ slot, candidates }) => ({ slot, branch: await firstSyncableBranch(path, candidates) }))
    )
  ).flatMap(({ slot, branch }) => (branch ? [{ slot, branch }] : []));

  // `status --porcelain` walks the whole worktree, and dirtiness only matters when a target
  // IS the checked-out branch — the common case (HEAD on a feature branch) skips the scan.
  const dirty =
    targets.some(({ branch }) => branch === current) &&
    (await runGit(path, ['status', '--porcelain'])).stdout.trim().length > 0;

  const branches: BranchSyncReport[] = [];
  for (const target of targets) {
    // Sequential: two concurrent `fetch .` in one repo race on .git/FETCH_HEAD.
    branches.push(await fastForwardBranch(path, target, { current, dirty }));
  }
  return { repo: path, slug, status: RepoSyncStatus.Synced, branches };
};

const repoField = {
  repo: z
    .string()
    .optional()
    .describe('OWNER/REPO. Defaults to the repo of KEVIN_CODE_PATH, then the first KEVIN_GIT_REPOS entry.')
};
const prNumberField = { number: z.number().int().positive().describe('Pull request number.') };
const issueNumberField = { number: z.number().int().positive().describe('Issue number.') };

const PR_VIEW_FIELDS = [
  'number',
  'title',
  'state',
  'author',
  'body',
  'headRefName',
  'baseRefName',
  'isDraft',
  'createdAt',
  'updatedAt',
  'url',
  'reviewDecision',
  'labels',
  'comments',
  'latestReviews',
  'additions',
  'deletions',
  'changedFiles',
  'files',
  'statusCheckRollup',
  'mergeable',
  'mergeStateStatus'
].join(',');

const PR_LIST_FIELDS = [
  'number',
  'title',
  'state',
  'author',
  'headRefName',
  'isDraft',
  'createdAt',
  'updatedAt',
  'url',
  'reviewDecision',
  'labels'
].join(',');

const PR_CHECKS_FIELDS = [
  'name',
  'state',
  'bucket',
  'link',
  'workflow',
  'event',
  'startedAt',
  'completedAt',
  'description'
].join(',');

const RUN_LIST_FIELDS = [
  'databaseId',
  'number',
  'name',
  'displayTitle',
  'workflowName',
  'headBranch',
  'headSha',
  'event',
  'status',
  'conclusion',
  'createdAt',
  'url'
].join(',');

const RUN_VIEW_FIELDS = [
  'databaseId',
  'name',
  'displayTitle',
  'workflowName',
  'headBranch',
  'headSha',
  'event',
  'status',
  'conclusion',
  'createdAt',
  'url',
  'jobs'
].join(',');

const ISSUE_LIST_FIELDS = [
  'number',
  'title',
  'state',
  'author',
  'labels',
  'assignees',
  'createdAt',
  'updatedAt',
  'url'
].join(',');

const ISSUE_VIEW_FIELDS = [
  'number',
  'title',
  'state',
  'stateReason',
  'author',
  'body',
  'labels',
  'assignees',
  'milestone',
  'comments',
  'createdAt',
  'updatedAt',
  'closedAt',
  'url'
].join(',');

export const tools: ToolDef[] = [
  defineTool({
    name: 'github_pr_list',
    description:
      'List pull requests for a repo (read-only). Returns number, title, state, author, branch, draft flag, review decision, labels, timestamps. Filter by state; cap with limit.',
    inputSchema: {
      ...repoField,
      state: z.enum(['open', 'closed', 'merged', 'all']).optional().describe('Defaults to open.'),
      limit: z.number().int().positive().max(100).optional().describe('Max PRs to return (default 20).')
    },
    handler: async ({ repo, state, limit }) => {
      const target = await resolveRepo(repo);
      return ghJson(`github:pr_list:${target}`, [
        'pr',
        'list',
        '-R',
        target,
        '--state',
        state ?? 'open',
        '--limit',
        String(limit ?? 20),
        '--json',
        PR_LIST_FIELDS
      ]);
    }
  }),

  defineTool({
    name: 'github_pr_view',
    description:
      'View one pull request in full (read-only): body, reviews, comments, changed files, diff stats, label/review state, and the status-check rollup. Use github_pr_diff for the actual patch.',
    inputSchema: { ...repoField, ...prNumberField },
    handler: async ({ repo, number }) => {
      const target = await resolveRepo(repo);
      return ghJson(`github:pr_view:${target}#${number}`, [
        'pr',
        'view',
        String(number),
        '-R',
        target,
        '--json',
        PR_VIEW_FIELDS
      ]);
    }
  }),

  defineTool({
    name: 'github_pr_diff',
    description:
      'The unified diff of a pull request (read-only). Pass nameOnly for just the changed file list. Large diffs are truncated to maxChars.',
    inputSchema: {
      ...repoField,
      ...prNumberField,
      nameOnly: z.boolean().optional().describe('Only the names of changed files, not the patch.'),
      maxChars: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(`Truncate the diff to this many characters (default ${DEFAULT_MAX_CHARS}).`)
    },
    handler: async ({ repo, number, nameOnly, maxChars }) => {
      const target = await resolveRepo(repo);
      const args = ['pr', 'diff', String(number), '-R', target, '--color', 'never'];
      if (nameOnly) {
        args.push('--name-only');
      }
      const diff = await runGh(args);
      return untrusted(`github:pr_diff:${target}#${number}`, clip(diff, maxChars ?? DEFAULT_MAX_CHARS));
    }
  }),

  defineTool({
    name: 'github_pr_checks',
    description:
      'Status of every check on a pull request (read-only): name, state, bucket (pass/fail/pending/skipping/cancel), workflow, and a link. The fast way to see what is red before pulling logs.',
    inputSchema: { ...repoField, ...prNumberField },
    handler: async ({ repo, number }) => {
      const target = await resolveRepo(repo);
      return ghJson(
        `github:pr_checks:${target}#${number}`,
        ['pr', 'checks', String(number), '-R', target, '--json', PR_CHECKS_FIELDS],
        { allowNonZero: true }
      );
    }
  }),

  defineTool({
    name: 'github_run_list',
    description:
      'List GitHub Actions workflow runs for a repo (read-only). Filter by branch, workflow, or status to find a failing run. Returns databaseId (use it with github_run_view / github_run_log), conclusion, status, branch, sha, event, timestamps.',
    inputSchema: {
      ...repoField,
      branch: z.string().optional().describe('Filter to runs on this head branch.'),
      workflow: z.string().optional().describe('Filter to a workflow by name or filename (e.g. ci.yml).'),
      status: z
        .enum(['queued', 'in_progress', 'completed', 'success', 'failure', 'cancelled', 'skipped'])
        .optional()
        .describe('Filter by run status/conclusion.'),
      limit: z.number().int().positive().max(100).optional().describe('Max runs to return (default 20).')
    },
    handler: async ({ repo, branch, workflow, status, limit }) => {
      const target = await resolveRepo(repo);
      const args = ['run', 'list', '-R', target, '--limit', String(limit ?? 20), '--json', RUN_LIST_FIELDS];
      if (branch) {
        args.push('--branch', branch);
      }
      if (workflow) {
        args.push('--workflow', workflow);
      }
      if (status) {
        args.push('--status', status);
      }
      return ghJson(`github:run_list:${target}`, args);
    }
  }),

  defineTool({
    name: 'github_run_view',
    description:
      'View one workflow run (read-only): overall status/conclusion plus the per-job, per-step breakdown so you can see which job and step failed. Pair with github_run_log for the failing log output.',
    inputSchema: {
      ...repoField,
      runId: z.number().int().positive().describe('The run databaseId from github_run_list.')
    },
    handler: async ({ repo, runId }) => {
      const target = await resolveRepo(repo);
      return ghJson(`github:run_view:${target}#${runId}`, [
        'run',
        'view',
        String(runId),
        '-R',
        target,
        '--json',
        RUN_VIEW_FIELDS
      ]);
    }
  }),

  defineTool({
    name: 'github_run_log',
    description:
      'Logs for a workflow run (read-only). Defaults to ONLY the failed steps — the right call for diagnosing a red build. Set fullLog to pull every step (large). Output is truncated to maxChars.',
    inputSchema: {
      ...repoField,
      runId: z.number().int().positive().describe('The run databaseId from github_run_list.'),
      fullLog: z.boolean().optional().describe('Pull the full log instead of failed steps only. Can be very large.'),
      maxChars: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(`Truncate the log to this many characters (default ${DEFAULT_MAX_CHARS}).`)
    },
    handler: async ({ repo, runId, fullLog, maxChars }) => {
      const target = await resolveRepo(repo);
      const logArg = fullLog ? '--log' : '--log-failed';
      const output = await runGh(['run', 'view', String(runId), '-R', target, logArg]);
      return untrusted(`github:run_log:${target}#${runId}`, clip(output, maxChars ?? DEFAULT_MAX_CHARS));
    }
  }),

  defineTool({
    name: 'github_issue_list',
    description:
      'List issues for a repo (read-only). Returns number, title, state, author, labels, assignees, timestamps. Filter by state; cap with limit. Excludes pull requests.',
    inputSchema: {
      ...repoField,
      state: z.enum(['open', 'closed', 'all']).optional().describe('Defaults to open.'),
      limit: z.number().int().positive().max(100).optional().describe('Max issues to return (default 20).')
    },
    handler: async ({ repo, state, limit }) => {
      const target = await resolveRepo(repo);
      return ghJson(`github:issue_list:${target}`, [
        'issue',
        'list',
        '-R',
        target,
        '--state',
        state ?? 'open',
        '--limit',
        String(limit ?? 20),
        '--json',
        ISSUE_LIST_FIELDS
      ]);
    }
  }),

  defineTool({
    name: 'github_issue_view',
    description:
      'View one issue in full (read-only): body, labels, assignees, milestone, comments, state/close reason, and timestamps.',
    inputSchema: { ...repoField, ...issueNumberField },
    handler: async ({ repo, number }) => {
      const target = await resolveRepo(repo);
      return ghJson(`github:issue_view:${target}#${number}`, [
        'issue',
        'view',
        String(number),
        '-R',
        target,
        '--json',
        ISSUE_VIEW_FIELDS
      ]);
    }
  }),

  defineTool({
    name: 'github_fast_forward',
    description:
      "Fast-forward the default branches (main||master and develop||dev) of the configured local checkouts so Kevin grounds against current code. Authenticates with the read-only PAT over HTTPS — one fetch per repo — then does every ref update locally; the checkout's own remote (SSH or otherwise) is neither used for transport nor rewritten. Strictly forward-only: never checks out, stashes, resets, rebases, cleans, or commits, and a dirty, diverged, or worktree-held branch is reported rather than resolved. Reports rather than throws when the GitHub pack isn't configured, so a caller can carry on. Returns per-repo status (SYNCED / NOT_CONFIGURED / NOT_A_MAIN_CHECKOUT / NOT_GITHUB / FETCH_FAILED with a reason) and per-branch status (UPDATED / CURRENT / AHEAD / SKIPPED_DIRTY / CLAIMED_BY_WORKTREE / NOT_FAST_FORWARD).",
    inputSchema: {
      repos: z
        .array(z.string())
        .optional()
        .describe('Paths to MAIN checkouts. Defaults to KEVIN_CODE_PATH plus KEVIN_GIT_REPOS.')
    },
    handler: async ({ repos }) => {
      // Every exit reports rather than throws. This runs as step 0 of sync, where code
      // freshness is a convenience: a home with no codebase, or no GitHub pack, must get a
      // status line and let the rest of the chain proceed.
      const report = (payload: Record<string, unknown>): string =>
        untrusted('github:fast_forward', JSON.stringify(payload, null, 2));

      const paths = [
        ...new Set(repos?.length ? repos.map((repo) => expandTilde(repo.trim())).filter(Boolean) : configuredRepoPaths())
      ];
      if (paths.length === 0) {
        return report({
          repos: [],
          detail: 'No checkouts configured — set KEVIN_CODE_PATH or KEVIN_GIT_REPOS, or pass repos explicitly.'
        });
      }
      const token = env('GITHUB_TOKEN');
      if (!token) {
        return report({
          repos: paths.map((path) => ({ repo: path, status: RepoSyncStatus.NotConfigured, branches: [] })),
          detail:
            'GITHUB_TOKEN not set — run /agent-kevin:configure-skills → GitHub pack. Checkouts were left untouched.'
        });
      }
      // Repos are independent checkouts, so the ~1s authenticated fetches overlap. Safe only
      // because paths are deduped AFTER tilde expansion — two spellings of one repo would
      // otherwise race on the same .git.
      const reports = await Promise.all(paths.map((path) => syncRepo(path, token)));
      log.info(`github fast-forward → ${reports.length} repo(s)`);
      return report({ repos: reports });
    }
  })
];
