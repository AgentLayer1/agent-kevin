import { describe, expect, test } from 'bun:test';
import type { SlackMessage, SlackUser } from './types';
import { owedMentions, permalink, sideFor, waitingThreads, type Judge, type Mention, type Thread } from './waiting';

const OURS = 'T0OURS';
const ME = 'UME';
const NOW = 1_800_000_000_000;
const USERS = new Map<string, SlackUser>([
  [ME, { id: ME, name: 'operator', team_id: OURS }],
  ['USUPPORT', { id: 'USUPPORT', name: 'teammate', team_id: OURS }],
  ['UGUEST', { id: 'UGUEST', name: 'guest', team_id: OURS, is_restricted: true }],
  ['UAPP', { id: 'UAPP', name: 'tracker', team_id: OURS, is_bot: true }],
  ['UACME', { id: 'UACME', name: 'acme-ops', team_id: 'T0ACME' }]
]);

const judge: Judge = {
  sideOf: sideFor(OURS, USERS),
  nameOf: (user) => user ?? 'unknown',
  link: permalink('https://example.slack.com/'),
  now: NOW,
  after: 60
};

const minutesAgo = (minutes: number): string => ((NOW - minutes * 60_000) / 1000).toFixed(6);

const message = (user: string | undefined, minutes: number, extra: Partial<SlackMessage> = {}): SlackMessage => ({
  type: 'message',
  user,
  text: '',
  ts: minutesAgo(minutes),
  ...extra
});

const thread = (...messages: SlackMessage[]): Thread => ({
  channelId: 'C1',
  channelName: 'team-acme',
  ts: messages[0]?.ts ?? '',
  messages
});

describe('waitingThreads', () => {
  test('an outside question with only an auto-reply bot behind it is waiting', () => {
    const waiting = waitingThreads(
      [
        thread(
          message('UACME', 90, { reply_count: 1 }),
          message(undefined, 89, { bot_id: 'B1', username: 'Auto-reply' })
        )
      ],
      judge
    );
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ channel: 'team-acme', from: 'UACME', minutes: 90, replies: 1 });
  });

  test('a reply from one of us clears the thread', () => {
    expect(waitingThreads([thread(message('UACME', 120), message('USUPPORT', 100))], judge)).toEqual([]);
  });

  test('an outside follow-up after our reply waits again, timed from the follow-up', () => {
    const [waiting] = waitingThreads(
      [thread(message('UACME', 300), message('USUPPORT', 200), message('UACME', 75))],
      judge
    );
    expect(waiting?.minutes).toBe(75);
  });

  test('a reaction from one of us on the last message counts as seen', () => {
    const seen = message('UACME', 120, { reactions: [{ name: 'eyes', count: 1, users: ['USUPPORT'] }] });
    const stranger = message('UACME', 120, { reactions: [{ name: 'eyes', count: 1, users: ['UACME'] }] });
    expect(waitingThreads([thread(seen)], judge)).toEqual([]);
    expect(waitingThreads([thread(stranger)], judge)).toHaveLength(1);
  });

  test('under the threshold is not waiting yet', () => {
    expect(waitingThreads([thread(message('UACME', 59))], judge)).toEqual([]);
  });

  test("a guest in our workspace is outside, and a bot user is nobody's reply", () => {
    expect(waitingThreads([thread(message('UGUEST', 90))], judge)).toHaveLength(1);
    expect(waitingThreads([thread(message('UACME', 90), message('UAPP', 80))], judge)).toHaveLength(1);
  });

  test('the poster workspace on a shared-channel message wins over the profile lookup', () => {
    expect(waitingThreads([thread(message('UNKNOWN', 90, { user_team: OURS }))], judge)).toEqual([]);
    expect(waitingThreads([thread(message('UNKNOWN', 90))], judge)).toHaveLength(1);
  });

  test('channel joins and deleted-message tombstones are not the last word', () => {
    const joined = message('UACME', 30, { subtype: 'channel_join' });
    expect(waitingThreads([thread(message('USUPPORT', 120), joined)], judge)).toEqual([]);
  });

  test('the longest wait comes first and links to the thread root', () => {
    const waiting = waitingThreads([thread(message('UACME', 90)), thread(message('UACME', 600))], judge);
    expect(waiting.map((item) => item.minutes)).toEqual([600, 90]);
    expect(waiting[0]?.url).toBe(`https://example.slack.com/archives/C1/p${minutesAgo(600).replace('.', '')}`);
  });
});

describe('owedMentions', () => {
  const mention = (mentioned: SlackMessage, ...messages: SlackMessage[]): Mention => ({
    ...thread(...messages),
    message: mentioned
  });

  test('a bare tag nobody answered is owed', () => {
    const tag = message('USUPPORT', 90);
    expect(owedMentions([mention(tag, message('UACME', 95), tag)], ME, judge)).toHaveLength(1);
  });

  test('my reply after the mention clears it, a reply before it does not', () => {
    const tag = message('USUPPORT', 90);
    expect(owedMentions([mention(tag, tag, message(ME, 80))], ME, judge)).toEqual([]);
    expect(owedMentions([mention(tag, message(ME, 100), tag)], ME, judge)).toHaveLength(1);
  });

  test('my own messages, bots and fresh mentions are skipped', () => {
    const mine = message(ME, 90);
    const bot = message(undefined, 90, { bot_id: 'B1' });
    const fresh = message('USUPPORT', 10);
    expect(owedMentions([mention(mine, mine), mention(bot, bot), mention(fresh, fresh)], ME, judge)).toEqual([]);
  });

  test("search's own permalink is the mention's link", () => {
    const tag = message('USUPPORT', 90);
    const [owed] = owedMentions(
      [{ ...mention(tag, tag), permalink: 'https://example.slack.com/archives/C1/p1' }],
      ME,
      judge
    );
    expect(owed?.url).toBe('https://example.slack.com/archives/C1/p1');
  });

  test('two mentions in one thread are one item, timed from the earlier', () => {
    const root = message('UACME', 200);
    const first = message('USUPPORT', 150, { thread_ts: root.ts });
    const second = message('USUPPORT', 70, { thread_ts: root.ts });
    const owed = owedMentions([mention(second, root, first, second), mention(first, root, first, second)], ME, judge);
    expect(owed).toHaveLength(1);
    expect(owed[0]?.minutes).toBe(150);
    expect(owed[0]?.url).toContain(`thread_ts=${root.ts}`);
  });
});
