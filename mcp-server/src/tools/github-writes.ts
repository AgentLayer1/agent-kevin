/**
 * GitHub writes: open an issue, comment on one, change its labels or milestone (with
 * screenshots or videos attached), and change a pull request's title or description.
 * Nothing closes, merges, or edits someone else's comment.
 *
 * They run on the repo owner's token, the same one the read tools use, so its permissions
 * decide what they may do: Issues or Pull requests write. Attaching needs no more on the token,
 * only the Write role on the repo. With no token for the owner they run as the operator's `gh auth login`.
 */
import { defineTool, type ToolDef } from '@/shared/types';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { z } from 'zod';
import { resolveRepo, runGh } from './github';

/** The file types gh's `--attach` uploads. */
const ATTACHABLE = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp4', '.mov', '.webm'] as const;

export const attachArgs = (paths: readonly string[] | undefined): string[] =>
  (paths ?? []).flatMap((path) => {
    if (!(ATTACHABLE as readonly string[]).includes(extname(path).toLowerCase())) {
      throw new Error(`Can't attach ${path}: GitHub takes only ${ATTACHABLE.join(' ')}. Put text such as a log in the body instead.`);
    }
    if (path.includes('#')) {
      throw new Error(`Can't attach ${path}: gh reads "#" as the start of alt text.`);
    }
    if (!existsSync(path)) {
      throw new Error(`Can't attach ${path}: no such file.`);
    }
    return ['--attach', path];
  });

interface IssueCreate {
  repo: string;
  title: string;
  body: string;
  labels?: readonly string[];
  milestone?: string;
  attachments?: readonly string[];
}

export const issueCreateArgs = ({ repo, title, body, labels, milestone, attachments }: IssueCreate): string[] => [
  'issue',
  'create',
  '-R',
  repo,
  '--title',
  title,
  '--body',
  body,
  ...(labels ?? []).flatMap((label) => ['--label', label]),
  ...(milestone ? ['--milestone', milestone] : []),
  ...attachArgs(attachments)
];

interface IssueUpdate {
  repo: string;
  number: number;
  title?: string;
  body?: string;
  addLabels?: readonly string[];
  removeLabels?: readonly string[];
  /** A milestone title, or '' to clear it. */
  milestone?: string;
}

export const issueEditArgs = ({ repo, number, title, body, addLabels, removeLabels, milestone }: IssueUpdate): string[] => {
  const changes = [
    ...(title === undefined ? [] : ['--title', title]),
    ...(body === undefined ? [] : ['--body', body]),
    ...(addLabels ?? []).flatMap((label) => ['--add-label', label]),
    ...(removeLabels ?? []).flatMap((label) => ['--remove-label', label]),
    ...(milestone === undefined ? [] : milestone === '' ? ['--remove-milestone'] : ['--milestone', milestone])
  ];
  if (changes.length === 0) {
    throw new Error('Nothing to change: pass title, body, add_labels, remove_labels or milestone.');
  }
  return ['issue', 'edit', String(number), '-R', repo, ...changes];
};

interface PrUpdate {
  repo: string;
  number: number;
  title?: string;
  body?: string;
}

export const prEditArgs = ({ repo, number, title, body }: PrUpdate): string[] => {
  const changes = [...(title === undefined ? [] : ['--title', title]), ...(body === undefined ? [] : ['--body', body])];
  if (changes.length === 0) {
    throw new Error('Nothing to change: pass title or body.');
  }
  return ['pr', 'edit', String(number), '-R', repo, ...changes];
};

const repoField = {
  repo: z
    .string()
    .optional()
    .describe('OWNER/REPO. Defaults to the configured code path repo, then the first configured git repo.')
};
const labelList = z.array(z.string().min(1));
const attachments = z
  .array(z.string().min(1))
  .max(50)
  .optional()
  .describe('Absolute paths of screenshots or videos to upload (png, jpg, gif, webp, svg, mp4, mov, webm), appended to the body.');

export const tools: ToolDef[] = [
  defineTool({
    name: 'github_issue_create',
    description:
      'Open a GitHub issue (writes to GitHub, visible to everyone with repo access). Search open issues with github_issue_list first and comment on a match instead of opening a duplicate. Labels and the milestone must already exist in the repo. Screenshots and videos go in attachments; text such as a log goes in the body. Returns the new issue URL.',
    inputSchema: {
      ...repoField,
      title: z.string().min(1),
      body: z.string().min(1).describe('Markdown body. No personal details of the people it concerns.'),
      labels: labelList.optional(),
      milestone: z.string().min(1).optional().describe('Milestone title.'),
      attachments
    },
    handler: async ({ repo, title, body, labels, milestone, attachments: files }) => {
      const target = await resolveRepo(repo);
      const url = (await runGh(target, issueCreateArgs({ repo: target, title, body, labels, milestone, attachments: files }))).trim();
      return { ok: true, repo: target, url };
    }
  }),
  defineTool({
    name: 'github_issue_comment',
    description:
      'Comment on a GitHub issue (writes to GitHub, visible to everyone with repo access), optionally with screenshots or videos attached.',
    inputSchema: {
      ...repoField,
      number: z.number().int().positive().describe('Issue number.'),
      body: z.string().min(1).describe('Markdown comment.'),
      attachments
    },
    handler: async ({ repo, number, body, attachments: files }) => {
      const target = await resolveRepo(repo);
      const url = (await runGh(target, ['issue', 'comment', String(number), '-R', target, '--body', body, ...attachArgs(files)])).trim();
      return { ok: true, repo: target, number, url };
    }
  }),
  defineTool({
    name: 'github_issue_update',
    description:
      "Change a GitHub issue's title, description, labels or milestone (writes to GitHub). A new title or description replaces the old text: only on an issue the operator asked to change, after reading it with github_issue_view and showing them the old and new text. Labels and the milestone must already exist in the repo. Does not close or reopen.",
    inputSchema: {
      ...repoField,
      number: z.number().int().positive().describe('Issue number.'),
      title: z.string().min(1).optional(),
      body: z.string().min(1).optional().describe('The whole new description, in Markdown.'),
      add_labels: labelList.optional(),
      remove_labels: labelList.optional(),
      milestone: z.string().optional().describe("Milestone title to set, or '' to clear it.")
    },
    handler: async ({ repo, number, title, body, add_labels, remove_labels, milestone }) => {
      const target = await resolveRepo(repo);
      const args = issueEditArgs({ repo: target, number, title, body, addLabels: add_labels, removeLabels: remove_labels, milestone });
      const url = (await runGh(target, args)).trim();
      return { ok: true, repo: target, number, url };
    }
  }),
  defineTool({
    name: 'github_pr_update',
    description:
      "Replace a pull request's title or description (writes to GitHub; the old text is gone). Only on a PR the operator asked to change: read it with github_pr_view first and show them the old and new text before calling.",
    inputSchema: {
      ...repoField,
      number: z.number().int().positive().describe('Pull request number.'),
      title: z.string().min(1).optional(),
      body: z.string().min(1).optional().describe('The whole new description, in Markdown.')
    },
    handler: async ({ repo, number, title, body }) => {
      const target = await resolveRepo(repo);
      await runGh(target, prEditArgs({ repo: target, number, title, body }));
      return { ok: true, repo: target, number, url: `https://github.com/${target}/pull/${number}` };
    }
  })
];
