/**
 * GitHub issue writes — the opt-in level above the read-only GitHub pack: open an
 * issue, comment on one, change its labels or milestone. Nothing closes, edits
 * someone's text, or touches a pull request.
 *
 * They run on their own token, `GITHUB_ISSUES_TOKEN` (a fine-grained PAT with
 * Issues read/write on the named repos only), so `GITHUB_TOKEN` stays read-only
 * and turning this level off is deleting one line.
 */
import { PLUGIN_NAME } from '@/config';
import { RUNTIME_DIR } from '@/shared/naming';
import { env } from '@/shared/env';
import { defineTool, type ToolDef } from '@/shared/types';
import { z } from 'zod';
import { repoOrDefault, runGhAs } from './github';

const requireIssuesToken = (): string => {
  const token = env('GITHUB_ISSUES_TOKEN');
  if (!token) {
    throw new Error(
      `GITHUB_ISSUES_TOKEN not set. Add a fine-grained PAT with Issues read/write on the repos it may touch to <HOME>/${RUNTIME_DIR}/secrets/.env as GITHUB_ISSUES_TOKEN (run /${PLUGIN_NAME}:configure-skills → GitHub pack → issue writes).`
    );
  }
  return token;
};

export interface IssueCreate {
  repo: string;
  title: string;
  body: string;
  labels?: readonly string[];
  milestone?: string;
}

export const issueCreateArgs = ({ repo, title, body, labels, milestone }: IssueCreate): string[] => [
  'issue',
  'create',
  '-R',
  repo,
  '--title',
  title,
  '--body',
  body,
  ...(labels ?? []).flatMap((label) => ['--label', label]),
  ...(milestone ? ['--milestone', milestone] : [])
];

export interface IssueUpdate {
  repo: string;
  number: number;
  addLabels?: readonly string[];
  removeLabels?: readonly string[];
  /** A milestone title, or '' to clear it. */
  milestone?: string;
}

export const issueEditArgs = ({ repo, number, addLabels, removeLabels, milestone }: IssueUpdate): string[] => {
  const changes = [
    ...(addLabels?.length ? ['--add-label', addLabels.join(',')] : []),
    ...(removeLabels?.length ? ['--remove-label', removeLabels.join(',')] : []),
    ...(milestone === undefined ? [] : milestone === '' ? ['--remove-milestone'] : ['--milestone', milestone])
  ];
  if (changes.length === 0) {
    throw new Error('Nothing to change: pass add_labels, remove_labels or milestone.');
  }
  return ['issue', 'edit', String(number), '-R', repo, ...changes];
};

const repoField = {
  repo: z
    .string()
    .optional()
    .describe('OWNER/REPO. Defaults to the configured code path repo, then the first configured git repo.')
};
const labelList = z.array(z.string().min(1));

export const tools: ToolDef[] = [
  defineTool({
    name: 'github_issue_create',
    description:
      'Open a GitHub issue (writes to GitHub, visible to everyone with repo access). Search open issues with github_issue_list first and comment on a match instead of opening a duplicate. Labels and the milestone must already exist in the repo. Returns the new issue URL.',
    inputSchema: {
      ...repoField,
      title: z.string().min(1),
      body: z.string().min(1).describe('Markdown body. No personal details of the people it concerns.'),
      labels: labelList.optional(),
      milestone: z.string().min(1).optional().describe('Milestone title.')
    },
    handler: async ({ repo, title, body, labels, milestone }) => {
      const token = requireIssuesToken();
      const target = await repoOrDefault(repo);
      const url = (await runGhAs(token, issueCreateArgs({ repo: target, title, body, labels, milestone }))).trim();
      return { ok: true, repo: target, url };
    }
  }),
  defineTool({
    name: 'github_issue_comment',
    description: 'Comment on a GitHub issue (writes to GitHub, visible to everyone with repo access).',
    inputSchema: {
      ...repoField,
      number: z.number().int().positive().describe('Issue number.'),
      body: z.string().min(1).describe('Markdown comment.')
    },
    handler: async ({ repo, number, body }) => {
      const token = requireIssuesToken();
      const target = await repoOrDefault(repo);
      const url = (await runGhAs(token, ['issue', 'comment', String(number), '-R', target, '--body', body])).trim();
      return { ok: true, repo: target, number, url };
    }
  }),
  defineTool({
    name: 'github_issue_update',
    description:
      "Change a GitHub issue's labels or milestone (writes to GitHub). Labels and the milestone must already exist in the repo. Does not close, reopen or edit the issue's text.",
    inputSchema: {
      ...repoField,
      number: z.number().int().positive().describe('Issue number.'),
      add_labels: labelList.optional(),
      remove_labels: labelList.optional(),
      milestone: z.string().optional().describe("Milestone title to set, or '' to clear it.")
    },
    handler: async ({ repo, number, add_labels, remove_labels, milestone }) => {
      const token = requireIssuesToken();
      const target = await repoOrDefault(repo);
      const args = issueEditArgs({ repo: target, number, addLabels: add_labels, removeLabels: remove_labels, milestone });
      const url = (await runGhAs(token, args)).trim();
      return { ok: true, repo: target, number, url };
    }
  })
];
