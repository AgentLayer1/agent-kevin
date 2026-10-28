import { describe, expect, test } from 'bun:test';
import { classify, type IssueNode, type PrNode, sinceOf, tally } from './github-sweep';

const ME = 'alice';
const user = (login: string) => ({ __typename: 'User', login });
const bot = (login: string) => ({ __typename: 'Bot', login });

let seq = 0;
const comment = (login: string, createdAt: string, body = 'a point', actor = user(login)) => ({
  author: actor,
  body,
  createdAt,
  url: `https://github.com/acme/app/pull/1#discussion_r${++seq}`
});

const thread = (comments: ReturnType<typeof comment>[], isResolved = false) => ({
  isResolved,
  isOutdated: false,
  path: 'src/a.ts',
  line: 10,
  authors: { nodes: comments.map(({ author }) => ({ author })) },
  last: { nodes: comments.slice(-1) }
});

const review = (login: string, state: string, submittedAt: string | null, body = '') => ({
  author: user(login),
  state,
  body,
  submittedAt,
  createdAt: submittedAt ?? '2026-10-01T00:00:00Z',
  url: `https://github.com/acme/app/pull/1#pullrequestreview-${++seq}`
});

const pr = (overrides: Partial<PrNode> = {}): PrNode => ({
  __typename: 'PullRequest',
  number: 1,
  title: 'A change',
  url: 'https://github.com/acme/app/pull/1',
  body: '',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: 'REVIEW_REQUIRED',
  author: user(ME),
  headRefName: 'alice/change',
  baseRefName: 'main',
  closingIssuesReferences: { nodes: [] },
  reviewRequests: { nodes: [] },
  commits: { nodes: [{ commit: { committedDate: '2026-10-10T00:00:00Z' } }] },
  comments: { nodes: [] },
  reviews: { nodes: [] },
  reviewThreads: { nodes: [] },
  ...overrides
});

const issue = (overrides: Partial<IssueNode> = {}): IssueNode => ({
  __typename: 'Issue',
  number: 50,
  title: 'A bug',
  url: 'https://github.com/acme/app/issues/50',
  author: user('bob'),
  assignees: { nodes: [user(ME)] },
  comments: { nodes: [] },
  ...overrides
});

const run = (prs: PrNode[], issues: IssueNode[] = [], since: string | null = null) =>
  classify({ login: ME, repo: 'acme/app', since, fetchedAt: '2026-10-28T00:00:00Z', prs, issues });

describe('owed threads', () => {
  test('on my PR, an unresolved thread where someone else spoke last is owed', () => {
    const sweep = run([pr({ reviewThreads: { nodes: [thread([comment('bob', '2026-10-21T00:00:00Z')])] } })]);
    expect(sweep.prs[0]?.owed).toHaveLength(1);
    expect(sweep.prs[0]?.owed[0]).toMatchObject({ who: 'bob', where: 'inline', kind: 'person', path: 'src/a.ts' });
  });

  test('a thread I answered last, or one that is resolved, is not owed', () => {
    const answered = thread([comment('bob', '2026-10-21T00:00:00Z'), comment(ME, '2026-10-22T00:00:00Z')]);
    const resolved = thread([comment('bob', '2026-10-21T00:00:00Z')], true);
    expect(run([pr({ reviewThreads: { nodes: [answered, resolved] } })]).prs[0]?.owed).toEqual([]);
  });

  test("on someone else's PR, only threads I took part in count", () => {
    const joined = thread([comment(ME, '2026-10-20T00:00:00Z'), comment('bob', '2026-10-21T00:00:00Z')]);
    const notJoined = thread([comment('carol', '2026-10-21T00:00:00Z')]);
    const sweep = run([pr({ author: user('bob'), reviewThreads: { nodes: [joined, notJoined] } })]);
    expect(sweep.prs[0]?.owed.map((item) => item.who)).toEqual(['bob']);
  });

  test('bot threads are owed and marked as bots', () => {
    const sweep = run([
      pr({ reviewThreads: { nodes: [thread([comment('cursor', '2026-10-21T00:00:00Z', 'High', bot('cursor'))])] } })
    ]);
    expect(sweep.prs[0]?.owed[0]?.kind).toBe('bot');
  });
});

describe('owed conversation', () => {
  test('on my PR, comments and review bodies after my last top-level word are owed; bot summaries are not', () => {
    const sweep = run([
      pr({
        comments: {
          nodes: [
            comment('bob', '2026-10-01T00:00:00Z', 'old, answered'),
            comment(ME, '2026-10-02T00:00:00Z', 'answer'),
            comment('bob', '2026-10-03T00:00:00Z', 'follow-up'),
            comment('coderabbitai', '2026-10-04T00:00:00Z', 'summary', bot('coderabbitai'))
          ]
        },
        reviews: {
          nodes: [
            review('carol', 'COMMENTED', '2026-10-05T00:00:00Z', 'ship it after X'),
            review('dave', 'COMMENTED', '2026-10-06T00:00:00Z')
          ]
        }
      })
    ]);
    expect(sweep.prs[0]?.owed.map((item) => [item.who, item.where])).toEqual([
      ['bob', 'conversation'],
      ['carol', 'review']
    ]);
  });

  test("on someone else's PR, only comments that mention me after my last word count", () => {
    const sweep = run([
      pr({
        author: user('bob'),
        comments: {
          nodes: [
            comment('carol', '2026-10-03T00:00:00Z', 'unrelated'),
            comment('carol', '2026-10-04T00:00:00Z', '@alice thoughts?')
          ]
        }
      })
    ]);
    expect(sweep.prs[0]?.owed.map((item) => item.body)).toEqual(['@alice thoughts?']);
  });

  test('a mention of a longer login is not a mention of me', () => {
    const sweep = run([
      pr({ author: user('bob'), comments: { nodes: [comment('carol', '2026-10-04T00:00:00Z', '@alice-bot ping')] } })
    ]);
    expect(sweep.prs[0]?.owed).toEqual([]);
  });

  test('items after `since` are new', () => {
    const sweep = run(
      [pr({ comments: { nodes: [comment('bob', '2026-10-10T00:00:00Z'), comment('bob', '2026-10-25T00:00:00Z')] } })],
      [],
      '2026-10-20T00:00:00Z'
    );
    expect(sweep.prs[0]?.owed.map((item) => item.new)).toEqual([false, true]);
  });
});

describe('review state', () => {
  const theirs = (overrides: Partial<PrNode>) => pr({ author: user('bob'), ...overrides });

  test('requested and never reviewed is owed; a draft is not', () => {
    const requests = { nodes: [{ requestedReviewer: user(ME) }] };
    expect(run([theirs({ reviewRequests: requests })]).prs[0]?.review).toBe('owed');
    expect(run([theirs({ reviewRequests: requests, isDraft: true })]).prs[0]?.review).toBe('none');
  });

  test('my own PENDING review wins over everything', () => {
    const sweep = run([
      theirs({
        reviewRequests: { nodes: [{ requestedReviewer: user(ME) }] },
        reviews: { nodes: [review(ME, 'PENDING', null)] }
      })
    ]);
    expect(sweep.prs[0]?.review).toBe('pending');
  });

  test('a push after my changes-requested review makes a re-review due; after an approval it does not', () => {
    const pushed = { nodes: [{ commit: { committedDate: '2026-10-20T00:00:00Z' } }] };
    expect(
      run([theirs({ commits: pushed, reviews: { nodes: [review(ME, 'CHANGES_REQUESTED', '2026-10-15T00:00:00Z')] } })])
        .prs[0]?.review
    ).toBe('re-review');
    expect(
      run([theirs({ commits: pushed, reviews: { nodes: [review(ME, 'APPROVED', '2026-10-15T00:00:00Z')] } })]).prs[0]
        ?.review
    ).toBe('none');
  });

  test('re-requested after a review is a re-review', () => {
    const sweep = run([
      theirs({
        reviewRequests: { nodes: [{ requestedReviewer: user(ME) }] },
        reviews: { nodes: [review(ME, 'APPROVED', '2026-10-15T00:00:00Z')] }
      })
    ]);
    expect(sweep.prs[0]?.review).toBe('re-review');
  });

  test('my own PR never owes a review', () => {
    expect(run([pr({ reviewRequests: { nodes: [{ requestedReviewer: user(ME) }] } })]).prs[0]?.review).toBe('none');
  });
});

describe('issues and linking', () => {
  test('an issue assigned to me owes comments after my last; an unrelated issue only mentions', () => {
    const assigned = issue({
      comments: { nodes: [comment(ME, '2026-10-01T00:00:00Z'), comment('bob', '2026-10-02T00:00:00Z')] }
    });
    const other = issue({
      number: 51,
      author: user('bob'),
      assignees: { nodes: [] },
      comments: {
        nodes: [
          comment('bob', '2026-10-02T00:00:00Z', 'no mention'),
          comment('bob', '2026-10-03T00:00:00Z', 'cc @alice')
        ]
      }
    });
    const sweep = run([], [assigned, other]);
    expect(sweep.issues.find((item) => item.number === 50)?.owed.map((item) => item.who)).toEqual(['bob']);
    expect(sweep.issues.find((item) => item.number === 51)?.owed.map((item) => item.body)).toEqual(['cc @alice']);
  });

  test('a PR links to the issues it closes or references, and the issue lists the PR', () => {
    const sweep = run(
      [
        pr({
          number: 7,
          body: 'Closes the code half of #50. See also #9.',
          closingIssuesReferences: { nodes: [{ number: 12 }] }
        })
      ],
      [issue()]
    );
    expect(sweep.prs[0]?.issues).toEqual([9, 12, 50]);
    expect(sweep.issues[0]?.prs).toEqual([7]);
  });
});

describe('since', () => {
  test('an offset timestamp is normalized to UTC, so comments compare against it correctly', () => {
    const since = sinceOf('2026-10-28T13:30:00+08:00');
    expect(since).toBe('2026-10-28T05:30:00.000Z');
    const sweep = run([pr({ comments: { nodes: [comment('bob', '2026-10-28T06:00:00Z')] } })], [], since);
    expect(sweep.prs[0]?.owed[0]?.new).toBe(true);
  });

  test('no since means a first sweep, and a malformed one is refused', () => {
    expect(sinceOf(undefined)).toBeNull();
    expect(() => sinceOf('last tuesday')).toThrow('Invalid since');
  });
});

describe('counts', () => {
  test('tally counts owed replies, new and bot ones, each review state, and only my own conflicts', () => {
    const theirs = (number: number, overrides: Partial<PrNode>) => pr({ number, author: user('bob'), ...overrides });
    const sweep = run(
      [
        pr({
          number: 1,
          mergeable: 'CONFLICTING',
          reviewThreads: {
            nodes: [
              thread([comment('bob', '2026-10-25T00:00:00Z')]),
              thread([comment('cursor', '2026-10-10T00:00:00Z', 'High', bot('cursor'))])
            ]
          }
        }),
        theirs(2, { mergeable: 'CONFLICTING', reviewRequests: { nodes: [{ requestedReviewer: user(ME) }] } }),
        theirs(3, { reviews: { nodes: [review(ME, 'PENDING', null)] } })
      ],
      [issue({ comments: { nodes: [comment('bob', '2026-10-26T00:00:00Z')] } })],
      '2026-10-20T00:00:00Z'
    );
    expect(tally(sweep)).toEqual({
      replies: 3,
      newReplies: 2,
      fromBots: 1,
      reviews: 1,
      reReviews: 0,
      pendingReviews: 1,
      conflicts: 1
    });
  });
});
