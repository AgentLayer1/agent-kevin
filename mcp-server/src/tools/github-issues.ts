/**
 * GitHub issue writes — the opt-in level above the read-only GitHub pack: open an
 * issue, comment on one, change its labels or milestone, with screenshots or
 * videos attached. Nothing closes, edits someone's text, or touches a pull request.
 *
 * They run as the operator's own `gh auth login`, or as `GITHUB_ISSUES_TOKEN` when
 * one is set; never as the read-only `GITHUB_TOKEN`. Attaching needs the login or a
 * classic token (a fine-grained PAT can't upload) and write access to the repo.
 */
import { env } from '@/shared/env';
import { defineTool, type ToolDef } from '@/shared/types';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { z } from 'zod';
import { resolveRepo, runGhAs } from './github';

const issuesToken = (): string | undefined => env('GITHUB_ISSUES_TOKEN');

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
  addLabels?: readonly string[];
  removeLabels?: readonly string[];
  /** A milestone title, or '' to clear it. */
  milestone?: string;
}

export const issueEditArgs = ({ repo, number, addLabels, removeLabels, milestone }: IssueUpdate): string[] => {
  const changes = [
    ...(addLabels ?? []).flatMap((label) => ['--add-label', label]),
    ...(removeLabels ?? []).flatMap((label) => ['--remove-label', label]),
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
      const url = (await runGhAs(issuesToken(), issueCreateArgs({ repo: target, title, body, labels, milestone, attachments: files }))).trim();
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
      const url = (
        await runGhAs(issuesToken(), ['issue', 'comment', String(number), '-R', target, '--body', body, ...attachArgs(files)])
      ).trim();
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
      const target = await resolveRepo(repo);
      const args = issueEditArgs({ repo: target, number, addLabels: add_labels, removeLabels: remove_labels, milestone });
      const url = (await runGhAs(issuesToken(), args)).trim();
      return { ok: true, repo: target, number, url };
    }
  })
];
