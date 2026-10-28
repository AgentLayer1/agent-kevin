/**
 * What Slack is waiting on: threads whose last word is from outside the workspace, mentions of
 * the operator they haven't answered, and channels they joined that the channel map doesn't list.
 * Returns who, where and how long, never message text, so an unattended sync can run it.
 */
import { inChunks } from '@/shared/utils';
import { readChannelMap, unmappedChannels } from './channel-map';
import * as slack from './client';
import { resolveUserDisplay, tsToIso } from './format';
import { buildUserCache, parseSince, parseThreadUrl, resolveChannels } from './operations';
import type { SlackMessage, SlackUser } from './types';

const CONCURRENCY = 5;
const HISTORY_LIMIT = 200;
const SEARCH_LIMIT = 100;
const HUMAN_SUBTYPES = new Set(['', 'thread_broadcast', 'file_share']);
const SLACKBOT = 'USLACKBOT';

type Side = 'ours' | 'theirs' | 'bot';

interface Waiting {
  channel: string;
  channel_id: string;
  thread_ts: string;
  url: string;
  from: string;
  since: string;
  minutes: number;
  replies: number;
}

export interface Thread {
  channelId: string;
  channelName: string;
  /** The thread root's ts. */
  ts: string;
  /** Root first, oldest to newest. */
  messages: readonly SlackMessage[];
}

export interface Mention extends Thread {
  message: SlackMessage;
  permalink?: string;
}

export interface Judge {
  sideOf: (user: string | undefined, userTeam?: string) => Side;
  nameOf: (user: string | undefined) => string;
  link: (channelId: string, ts: string, threadTs?: string) => string;
  /** Epoch milliseconds. */
  now: number;
  /** Minutes a message must have waited to count. */
  after: number;
}

const isPerson = (message: SlackMessage, judge: Judge): boolean =>
  !message.bot_id &&
  message.user !== SLACKBOT &&
  HUMAN_SUBTYPES.has(message.subtype ?? '') &&
  judge.sideOf(message.user, message.user_team) !== 'bot';

const minutesSince = (ts: string, now: number): number => Math.floor((now - Number.parseFloat(ts) * 1000) / 60_000);

const threadKey = (channelId: string, threadTs: string): string => `${channelId}:${threadTs}`;

const byLongestWait = (left: Waiting, right: Waiting): number => right.minutes - left.minutes;

const toWaiting = (thread: Thread, message: SlackMessage, url: string, judge: Judge): Waiting => ({
  channel: thread.channelName,
  channel_id: thread.channelId,
  thread_ts: thread.ts,
  url,
  from: judge.nameOf(message.user),
  since: tsToIso(message.ts),
  minutes: minutesSince(message.ts, judge.now),
  replies: thread.messages.length - 1
});

export const waitingThreads = (threads: readonly Thread[], judge: Judge): Waiting[] =>
  threads
    .flatMap((thread) => {
      const last = thread.messages.filter((message) => isPerson(message, judge)).at(-1);
      if (!last || judge.sideOf(last.user, last.user_team) !== 'theirs') {
        return [];
      }
      const seen = (last.reactions ?? []).some((reaction) =>
        reaction.users.some((user) => judge.sideOf(user) === 'ours')
      );
      return seen ? [] : [toWaiting(thread, last, judge.link(thread.channelId, thread.ts), judge)];
    })
    .filter((item) => item.minutes >= judge.after)
    .sort(byLongestWait);

export const owedMentions = (mentions: readonly Mention[], me: string, judge: Judge): Waiting[] => {
  const owed = mentions
    .filter(
      ({ message, messages }) =>
        message.user !== me &&
        isPerson(message, judge) &&
        !messages.some((reply) => reply.user === me && Number.parseFloat(reply.ts) > Number.parseFloat(message.ts))
    )
    .map((mention) =>
      toWaiting(
        mention,
        mention.message,
        mention.permalink ?? judge.link(mention.channelId, mention.message.ts, mention.ts),
        judge
      )
    )
    .filter((item) => item.minutes >= judge.after)
    .sort(byLongestWait);
  return owed.filter(
    (item, index) =>
      owed.findIndex((other) => other.channel_id === item.channel_id && other.thread_ts === item.thread_ts) === index
  );
};

export const permalink =
  (workspaceUrl: string) =>
  (channelId: string, ts: string, threadTs?: string): string => {
    const url = new URL(`archives/${channelId}/p${ts.replace('.', '')}`, workspaceUrl);
    if (threadTs && threadTs !== ts) {
      url.searchParams.set('thread_ts', threadTs);
      url.searchParams.set('cid', channelId);
    }
    return url.toString();
  };

export const sideFor =
  (teamId: string, users: ReadonlyMap<string, SlackUser>) =>
  (user: string | undefined, userTeam?: string): Side => {
    const info = user ? users.get(user) : undefined;
    if (!user || info?.is_bot) {
      return 'bot';
    }
    if (info?.is_restricted || info?.is_ultra_restricted) {
      return 'theirs';
    }
    return (userTeam ?? info?.team_id) === teamId ? 'ours' : 'theirs';
  };

export async function getWaiting(opts: { channels?: string[]; since?: string; after?: number }): Promise<{
  checkedAt: string;
  after: number;
  external: Waiting[];
  mentions: Waiting[];
  missing: string[];
  unreadable: string[];
  /**
   * Channels the operator is in that slack-channels.md doesn't list; null when there is no map yet.
   */
  unmapped: string[] | null;
  /** A read stopped at its limit, so either list may be short. */
  more: boolean;
}> {
  const now = Date.now();
  const after = opts.after ?? 60;
  const oldest = parseSince(opts.since ?? '7d') ?? 0;
  const unreadable = new Set<string>();
  const readOr = async (channel: { name: string }, read: () => Promise<SlackMessage[]>): Promise<SlackMessage[]> => {
    try {
      return await read();
    } catch {
      unreadable.add(channel.name);
      return [];
    }
  };

  const identity = await slack.authTest();
  // Search's `after:` excludes the day it names.
  const sinceDay = new Date((oldest - 86_400) * 1000).toISOString().slice(0, 10);
  const searching = slack.searchMessages(`<@${identity.user_id}> after:${sinceDay}`, SEARCH_LIMIT);
  const membership = await slack.listChannels();
  const listed = readChannelMap();
  const { resolved, missing } = opts.channels?.length
    ? await resolveChannels(opts.channels, membership)
    : { resolved: [], missing: [] };

  const histories = await inChunks(resolved, CONCURRENCY, async (channel) => ({
    channel,
    messages: await readOr(channel, () => slack.history(channel.id, { oldest, limit: HISTORY_LIMIT }))
  }));
  const roots = histories.flatMap(({ channel, messages }) =>
    messages
      .filter(
        (message) =>
          (!message.thread_ts || message.thread_ts === message.ts) &&
          (!message.latest_reply || minutesSince(message.latest_reply, now) >= after)
      )
      .map((message) => ({ channel, message }))
  );
  const threads: Thread[] = await inChunks(roots, CONCURRENCY, async ({ channel, message }) => ({
    channelId: channel.id,
    channelName: channel.name,
    ts: message.ts,
    messages:
      (message.reply_count ?? 0) > 0 ? await readOr(channel, () => slack.thread(channel.id, message.ts)) : [message]
  }));

  const found = await searching;
  const hits = found.matches.flatMap(({ channel, permalink, ...message }) =>
    channel &&
    !channel.is_im &&
    !channel.is_mpim &&
    message.user !== identity.user_id &&
    !message.bot_id &&
    Number.parseFloat(message.ts) >= oldest &&
    minutesSince(message.ts, now) >= after
      ? [{ channel, permalink, message, ts: permalink ? parseThreadUrl(permalink).thread_ts : message.ts }]
      : []
  );
  const fetched = new Map(threads.map((thread) => [threadKey(thread.channelId, thread.ts), thread.messages]));
  const toFetch = [
    ...new Map(
      hits
        .filter((hit) => !fetched.has(threadKey(hit.channel.id, hit.ts)))
        .map((hit) => [threadKey(hit.channel.id, hit.ts), hit])
    ).values()
  ];
  const read = await inChunks(toFetch, CONCURRENCY, async (hit) => ({
    key: threadKey(hit.channel.id, hit.ts),
    messages: await readOr(hit.channel, () => slack.thread(hit.channel.id, hit.ts))
  }));
  const threadsByKey = new Map([...fetched, ...read.map(({ key, messages }) => [key, messages] as const)]);
  const mentions: Mention[] = hits.flatMap(({ channel, permalink, message, ts }) => {
    const messages = threadsByKey.get(threadKey(channel.id, ts)) ?? [];
    return messages.length > 0
      ? [{ channelId: channel.id, channelName: channel.name, ts, messages, message, permalink }]
      : [];
  });

  const users = await buildUserCache([
    ...threads.flatMap(({ messages }) =>
      messages.flatMap((message) => [
        message.user ?? '',
        ...(message.reactions ?? []).flatMap((reaction) => reaction.users)
      ])
    ),
    ...mentions.map(({ message }) => message.user ?? '')
  ]);
  const judge: Judge = {
    sideOf: sideFor(identity.team_id, users),
    nameOf: (user) => resolveUserDisplay(user, users),
    link: permalink(identity.url),
    now,
    after
  };

  const owed = owedMentions(mentions, identity.user_id, judge);
  const owedKeys = new Set(owed.map((item) => threadKey(item.channel_id, item.thread_ts)));
  return {
    checkedAt: new Date(now).toISOString(),
    after,
    external: waitingThreads(threads, judge).filter(
      (item) => !owedKeys.has(threadKey(item.channel_id, item.thread_ts))
    ),
    mentions: owed,
    missing,
    unreadable: [...unreadable],
    unmapped: listed ? unmappedChannels(membership, listed) : null,
    more: found.total > found.matches.length || histories.some(({ messages }) => messages.length >= HISTORY_LIMIT)
  };
}
