/**
 * GitHub tools — read-only `gh` CLI wrapper.
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
 * Scope is deliberately read-only — list/view PRs, diffs, checks, and diagnose failing
 * workflow runs. No write subcommands (comment/create/merge/re-run) are exposed; those
 * leave the machine and stay a maintainer-gated, human-in-terminal activity.
 *
 * GitHub responses cross a trust boundary, so every payload is wrapped with `untrusted()`.
 */
import { env } from '@/shared/env';
import { log } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { untrusted } from '@/shared/untrusted';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Match `owner/repo` out of an SSH or HTTPS GitHub remote URL. */
const GH_REMOTE_RE = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/;

/** gh log/diff output is unbounded; cap text payloads so a giant CI log can't blow up context. */
const DEFAULT_MAX_CHARS = 100_000;

const expandTilde = (path: string): string => (path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path);

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

/** `owner/repo` from a local checkout's `origin` remote, or null if it isn't a GitHub repo. */
const repoSlugFromPath = async (path: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync('git', ['-C', expandTilde(path), 'remote', 'get-url', 'origin'], {
      encoding: 'utf8'
    });
    return parseGitHubRemote(stdout);
  } catch {
    return null;
  }
};

/** KEVIN_CODE_PATH's repo → first KEVIN_GIT_REPOS entry's repo → throw (caller must pass `repo`). */
const resolveDefaultRepo = async (): Promise<string> => {
  const candidates = [env('KEVIN_CODE_PATH'), ...(env('KEVIN_GIT_REPOS')?.split(',') ?? [])]
    .map((path) => path?.trim())
    .filter((path): path is string => Boolean(path));
  for (const path of candidates) {
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
  })
];
