/**
 * `github_sweep` — everything on one repo that is waiting on the operator, decided from GitHub's own
 * fields: unresolved threads whose last word isn't theirs, comments after their last one, review
 * requests they haven't answered, re-reviews a push has made due, and their own reviews left PENDING.
 * Read-only; the engineer skill's github-sweep playbook drafts the replies and renders the page.
 */
import { FILES } from '@/config';
import { daysAgoDate } from '@/shared/date';
import { defineTool, type ToolDef } from '@/shared/types';
import { untrusted } from '@/shared/untrusted';
import { boldField } from '@/status/collect';
import { z } from 'zod';
import { repoField, resolveRepo, runGh } from './github';

const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const BODY_LIMIT = 600;
const KNOWN_BOTS = new Set(['cursor', 'coderabbitai']);
const SEARCH_LIMIT = 50;

interface Actor {
  __typename?: string;
  login?: string;
}

interface CommentNode {
  author: Actor | null;
  body: string;
  createdAt: string;
  url: string;
}

interface ReviewNode extends CommentNode {
  state: string;
  submittedAt: string | null;
}

interface ThreadNode {
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  authors: { nodes: { author: Actor | null }[] };
  last: { nodes: CommentNode[] };
}

interface Connection<Node> {
  pageInfo?: { hasNextPage?: boolean; hasPreviousPage?: boolean };
  nodes: Node[];
}

export interface PrNode {
  __typename: 'PullRequest';
  number: number;
  title: string;
  url: string;
  body: string;
  isDraft: boolean;
  mergeable: string;
  reviewDecision: string | null;
  author: Actor | null;
  headRefName: string;
  baseRefName: string;
  closingIssuesReferences: { nodes: { number: number }[] };
  reviewRequests: { nodes: { requestedReviewer: Actor | null }[] };
  commits: { nodes: { commit: { committedDate: string } }[] };
  comments: Connection<CommentNode>;
  reviews: Connection<ReviewNode>;
  reviewThreads: Connection<ThreadNode>;
}

export interface IssueNode {
  __typename: 'Issue';
  number: number;
  title: string;
  url: string;
  author: Actor | null;
  assignees: { nodes: Actor[] };
  comments: Connection<CommentNode>;
}

export interface Owed {
  id: string;
  url: string;
  who: string;
  kind: 'person' | 'bot';
  at: string;
  where: 'inline' | 'conversation' | 'review' | 'issue';
  body: string;
  new: boolean;
  path?: string;
  line?: number | null;
  outdated?: boolean;
}

export type ReviewState = 'pending' | 'owed' | 're-review' | 'none';

export interface SweepPr {
  number: number;
  title: string;
  url: string;
  author: string;
  mine: boolean;
  draft: boolean;
  mergeable: string;
  reviewDecision: string | null;
  head: string;
  base: string;
  issues: number[];
  review: ReviewState;
  owed: Owed[];
}

export interface SweepIssue {
  number: number;
  title: string;
  url: string;
  author: string;
  assignees: string[];
  mine: boolean;
  prs: number[];
  owed: Owed[];
}

export interface Sweep {
  login: string;
  repo: string;
  fetchedAt: string;
  since: string | null;
  prs: SweepPr[];
  issues: SweepIssue[];
  truncated: string[];
}

const loginOf = (actor: Actor | null): string => actor?.login ?? 'ghost';

const isBot = (actor: Actor | null): boolean =>
  actor?.__typename === 'Bot' || KNOWN_BOTS.has(loginOf(actor).toLowerCase());

const same = (actor: Actor | null, login: string): boolean => loginOf(actor).toLowerCase() === login.toLowerCase();

const mentions = (body: string, login: string): boolean => new RegExp(`(^|[^\\w-])@${login}(?![\\w-])`, 'i').test(body);

const clip = (text: string): string => (text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}…` : text);

const fragment = (url: string): string => url.slice(url.indexOf('#') + 1);

const isNew = (at: string, since: string | null): boolean => since !== null && at > since;

const owedFrom = (
  comment: CommentNode,
  where: Owed['where'],
  since: string | null,
  extra: Pick<Owed, 'path' | 'line' | 'outdated'> = {}
): Owed => ({
  id: fragment(comment.url),
  url: comment.url,
  who: loginOf(comment.author),
  kind: isBot(comment.author) ? 'bot' : 'person',
  at: comment.createdAt,
  where,
  body: clip(comment.body.trim()),
  new: isNew(comment.createdAt, since),
  ...extra
});

const latest = (stamps: string[]): string => stamps.reduce((max, stamp) => (stamp > max ? stamp : max), '');

/**
 * Unresolved threads where the last word isn't the operator's. On their own PR every such thread is
 * owed; on someone else's, only threads they took part in.
 */
const threadOwed = (pr: PrNode, login: string, mine: boolean, since: string | null): Owed[] =>
  pr.reviewThreads.nodes
    .filter((thread) => !thread.isResolved)
    .filter((thread) => mine || thread.authors.nodes.some(({ author }) => same(author, login)))
    .flatMap((thread) =>
      thread.last.nodes
        .filter((last) => !same(last.author, login))
        .map((last) =>
          owedFrom(last, 'inline', since, { path: thread.path, line: thread.line, outdated: thread.isOutdated })
        )
    );

/**
 * Comments from people after the operator's last word that still need them: every one on their own
 * PR or issue, only mentions elsewhere. Bots' top-level posts are summaries, not questions.
 */
const afterLastMine = <Item extends { comment: CommentNode }>(items: Item[], login: string, mine: boolean): Item[] => {
  const lastMine = latest(
    items.filter(({ comment }) => same(comment.author, login)).map(({ comment }) => comment.createdAt)
  );
  return items.filter(
    ({ comment }) =>
      !same(comment.author, login) &&
      !isBot(comment.author) &&
      comment.createdAt > lastMine &&
      (mine || mentions(comment.body, login))
  );
};

const conversationOwed = (pr: PrNode, login: string, mine: boolean, since: string | null): Owed[] => {
  const topLevel = [
    ...pr.comments.nodes.map((comment) => ({ comment, where: 'conversation' as const })),
    // An empty review body only carries inline threads; a pending one isn't visible to anyone else.
    ...pr.reviews.nodes
      .filter((review) => review.state !== 'PENDING' && review.body.trim())
      .map((review) => ({
        comment: { ...review, createdAt: review.submittedAt ?? review.createdAt },
        where: 'review' as const
      }))
  ];
  return afterLastMine(topLevel, login, mine)
    .sort((left, right) => left.comment.createdAt.localeCompare(right.comment.createdAt))
    .map(({ comment, where }) => owedFrom(comment, where, since));
};

const reviewState = (pr: PrNode, login: string): ReviewState => {
  const mineReviews = pr.reviews.nodes.filter((review) => same(review.author, login));
  if (mineReviews.some((review) => review.state === 'PENDING')) {
    return 'pending';
  }
  const submitted = mineReviews.filter((review) => review.submittedAt);
  const requested = pr.reviewRequests.nodes.some((request) => same(request.requestedReviewer, login));
  if (requested && !pr.isDraft) {
    return submitted.length ? 're-review' : 'owed';
  }
  const last = submitted.reduce<ReviewNode | undefined>(
    (max, review) => (!max || (review.submittedAt ?? '') > (max.submittedAt ?? '') ? review : max),
    undefined
  );
  const lastCommit = pr.commits.nodes[0]?.commit.committedDate ?? '';
  return last && ['COMMENTED', 'CHANGES_REQUESTED'].includes(last.state) && lastCommit > (last.submittedAt ?? '')
    ? 're-review'
    : 'none';
};

const referencedIssues = (pr: PrNode): number[] =>
  [
    ...new Set([
      ...pr.closingIssuesReferences.nodes.map((issue) => issue.number),
      ...[...(pr.body ?? '').matchAll(/(?:^|[^\w&/])#(\d+)\b/g)].map((match) => Number(match[1]))
    ])
  ]
    .filter((number) => number !== pr.number)
    .sort((left, right) => left - right);

const classifyPr = (node: PrNode, login: string, since: string | null): SweepPr => {
  const mine = same(node.author, login);
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    author: loginOf(node.author),
    mine,
    draft: node.isDraft,
    mergeable: node.mergeable,
    reviewDecision: node.reviewDecision,
    head: node.headRefName,
    base: node.baseRefName,
    issues: referencedIssues(node),
    review: mine ? 'none' : reviewState(node, login),
    owed: [...threadOwed(node, login, mine, since), ...conversationOwed(node, login, mine, since)]
  };
};

const classifyIssue = (node: IssueNode, login: string, since: string | null, prs: SweepPr[]): SweepIssue => {
  const assignees = node.assignees.nodes.map(loginOf);
  const mine = same(node.author, login) || node.assignees.nodes.some((assignee) => same(assignee, login));
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    author: loginOf(node.author),
    assignees,
    mine,
    prs: prs.filter((pr) => pr.issues.includes(node.number)).map((pr) => pr.number),
    owed: afterLastMine(
      node.comments.nodes.map((comment) => ({ comment })),
      login,
      mine
    ).map(({ comment }) => owedFrom(comment, 'issue', since))
  };
};

const truncation = (pr: PrNode): string[] =>
  [
    pr.comments.pageInfo?.hasPreviousPage && `#${pr.number} conversation comments`,
    pr.reviews.pageInfo?.hasPreviousPage && `#${pr.number} reviews`,
    pr.reviewThreads.pageInfo?.hasNextPage && `#${pr.number} review threads`
  ].filter((note): note is string => Boolean(note));

/** Decide what is owed from already-fetched nodes. Pure, so the rules are testable without GitHub. */
export const classify = (input: {
  login: string;
  repo: string;
  since: string | null;
  fetchedAt: string;
  prs: PrNode[];
  issues: IssueNode[];
  truncated?: string[];
}): Sweep => {
  const prs = input.prs
    .map((pr) => classifyPr(pr, input.login, input.since))
    .sort((left, right) => right.number - left.number);
  const issues = input.issues
    .map((issue) => classifyIssue(issue, input.login, input.since, prs))
    .sort((left, right) => right.number - left.number);
  return {
    login: input.login,
    repo: input.repo,
    fetchedAt: input.fetchedAt,
    since: input.since,
    prs,
    issues,
    truncated: [...(input.truncated ?? []), ...input.prs.flatMap(truncation)]
  };
};

const ACTOR = '{ __typename login }';
const COMMENT = `{ author ${ACTOR} body createdAt url }`;

// A thread needs only who took part plus its last comment in full, so long bot threads don't ship every body.
const searchDocument = (fields: string): string => `
query($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    pageInfo { hasNextPage }
    nodes { __typename ${fields} }
  }
}`;

const PR_SEARCH = searchDocument(`... on PullRequest {
  number title url body isDraft mergeable reviewDecision headRefName baseRefName
  author ${ACTOR}
  closingIssuesReferences(first: 10) { nodes { number } }
  reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } } } }
  commits(last: 1) { nodes { commit { committedDate } } }
  comments(last: 60) { pageInfo { hasPreviousPage } nodes ${COMMENT} }
  reviews(last: 60) { pageInfo { hasPreviousPage } nodes { author ${ACTOR} state body submittedAt createdAt url } }
  reviewThreads(first: 80) {
    pageInfo { hasNextPage }
    nodes {
      isResolved isOutdated path line
      authors: comments(first: 40) { nodes { author ${ACTOR} } }
      last: comments(last: 1) { nodes ${COMMENT} }
    }
  }
}`);

const ISSUE_SEARCH = searchDocument(`... on Issue {
  number title url
  author ${ACTOR}
  assignees(first: 10) { nodes { login } }
  comments(last: 60) { pageInfo { hasPreviousPage } nodes ${COMMENT} }
}`);

interface SearchResult {
  data?: { search: { pageInfo: { hasNextPage: boolean }; nodes: (PrNode | IssueNode | object)[] } };
  errors?: { message: string }[];
}

const search = async (repo: string, query: string): Promise<{ nodes: (PrNode | IssueNode)[]; more: boolean }> => {
  const stdout = await runGh(repo, [
    'api',
    'graphql',
    '-f',
    `query=${query.startsWith('is:pr') ? PR_SEARCH : ISSUE_SEARCH}`,
    '-f',
    `q=repo:${repo} ${query}`,
    '-F',
    `first=${SEARCH_LIMIT}`
  ]);
  const parsed = JSON.parse(stdout) as SearchResult;
  if (!parsed.data) {
    throw new Error(
      `GitHub search failed for "${query}": ${parsed.errors?.map((error) => error.message).join('; ') ?? 'no data'}`
    );
  }
  const nodes = parsed.data.search.nodes.filter(
    (node): node is PrNode | IssueNode =>
      '__typename' in node && (node.__typename === 'PullRequest' || node.__typename === 'Issue')
  );
  return { nodes, more: parsed.data.search.pageInfo.hasNextPage };
};

/** One node per number: a PR found by several searches (authored and involved, say) is classified once. */
const unique = <Node extends { number: number }>(nodes: Node[]): Node[] => [
  ...new Map(nodes.map((node) => [node.number, node])).values()
];

export const sinceOf = (given: string | undefined): string | null => {
  if (given === undefined) {
    return null;
  }
  const at = new Date(given);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`Invalid since (expected an ISO timestamp): ${given}`);
  }
  return at.toISOString();
};

const operatorLogin = (given: string | undefined): string => {
  const raw = (given ?? boldField(FILES.USER, 'GitHub login')).replace(/[`@]/g, '').trim();
  if (!raw) {
    throw new Error('No GitHub login: pass `login`, or add `**GitHub login:** <login>` to USER.md.');
  }
  if (!LOGIN_RE.test(raw)) {
    throw new Error(`Invalid GitHub login: ${raw}`);
  }
  return raw;
};

export const tools: ToolDef[] = [
  defineTool({
    name: 'github_sweep',
    description:
      "Everything on one repo waiting on the operator (read-only): their open PRs, PRs requesting their review, PRs and issues they're involved in, and open issues assigned to or opened by them. Each comes back with conflicts-with-main, review state (owed, re-review after a push, their own review left PENDING) and the comments they owe an answer to (unresolved threads where someone else spoke last, comments after their last one, mentions). Login defaults to USER.md's GitHub login.",
    inputSchema: {
      ...repoField,
      login: z.string().optional().describe("The operator's GitHub login. Defaults to USER.md's **GitHub login:**."),
      since: z.string().optional().describe('ISO timestamp of the previous sweep; comments after it are flagged new.'),
      windowDays: z
        .number()
        .int()
        .positive()
        .max(90)
        .optional()
        .describe('Lookback for PRs and issues the operator is only involved in (default 21).')
    },
    handler: async ({ repo, login, since, windowDays }) => {
      const target = await resolveRepo(repo);
      const user = operatorLogin(login);
      const from = sinceOf(since);
      const after = daysAgoDate(windowDays ?? 21);
      const queries = [
        `is:pr is:open author:${user}`,
        `is:pr is:open review-requested:${user}`,
        `is:pr is:open involves:${user} -author:${user} updated:>=${after}`,
        `is:issue is:open assignee:${user}`,
        `is:issue is:open author:${user}`,
        `is:issue is:open involves:${user} -author:${user} -assignee:${user} updated:>=${after}`
      ];
      const results = await Promise.all(queries.map(async (query) => ({ query, ...(await search(target, query)) })));
      const nodes = results.flatMap((result) => result.nodes);
      const sweep = classify({
        login: user,
        repo: target,
        since: from,
        fetchedAt: new Date().toISOString(),
        prs: unique(nodes.filter((node): node is PrNode => node.__typename === 'PullRequest')),
        issues: unique(nodes.filter((node): node is IssueNode => node.__typename === 'Issue')),
        truncated: results
          .filter((result) => result.more)
          .map((result) => `search "${result.query}" has more than ${SEARCH_LIMIT} results`)
      });
      return untrusted(`github:sweep:${target}`, JSON.stringify(sweep));
    }
  })
];
