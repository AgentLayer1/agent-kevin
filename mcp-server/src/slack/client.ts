/**
 * Slack Web API client — read-only, minimal surface.
 *
 * Only the methods we need (`conversations.list`, `conversations.history`,
 * `conversations.replies`, `users.info`, `users.list`, `search.messages`,
 * `auth.test`). No write methods exposed.
 *
 * Handles 429 rate-limit retry with Retry-After header. Cursor-paginates
 * collection endpoints.
 */
import { log as baseLog } from '@/shared/log';
import { getAccessToken } from './oauth';
import type { SlackChannel, SlackMessage, SlackUser } from './types';
import { pluginName } from '@/shared/naming';

const AGENT_CLI = pluginName().replace(/^agent-/, '');

const log = baseLog.slack.with('client');
const SLACK_API_BASE = 'https://slack.com/api';

interface ApiResponse {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
}

async function call<T extends ApiResponse>(method: string, params: Record<string, string | number> = {}): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${SLACK_API_BASE}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '1');
      log.warn(`${method} rate-limited; sleeping ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    const data = (await res.json()) as T;
    if (!data.ok) {
      throw new Error(`Slack API ${method} failed: ${data.error ?? `HTTP ${res.status}`}`);
    }
    return data;
  }
  throw new Error(`Slack API ${method} failed: exhausted retries (rate limit)`);
}

interface AuthTestResponse extends ApiResponse {
  user: string;
  user_id: string;
  team: string;
  team_id: string;
  url: string;
}

export async function authTest(): Promise<AuthTestResponse> {
  return call<AuthTestResponse>('auth.test');
}

interface ConversationsListResponse extends ApiResponse {
  channels: SlackChannel[];
}

export async function listChannels(): Promise<SlackChannel[]> {
  const all: SlackChannel[] = [];
  let cursor = '';
  do {
    const params: Record<string, string | number> = {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: 1000
    };
    if (cursor) params.cursor = cursor;
    const data = await call<ConversationsListResponse>('conversations.list', params);
    all.push(...data.channels.filter((c) => c.is_member));
    cursor = data.response_metadata?.next_cursor ?? '';
  } while (cursor);
  return all;
}

export async function resolveChannelId(nameOrId: string): Promise<{ id: string; name: string }> {
  if (/^C[A-Z0-9]+$/.test(nameOrId) || /^G[A-Z0-9]+$/.test(nameOrId)) {
    const info = await conversationsInfo(nameOrId);
    return { id: info.id, name: info.name };
  }
  const cleaned = nameOrId.replace(/^#/, '');
  const channels = await listChannels();
  const match = channels.find((c) => c.name === cleaned);
  if (!match) {
    throw new Error(
      `Channel "${cleaned}" not found in your Slack membership. ` +
        `Join the channel in Slack, then try again. (Run \`${AGENT_CLI} slack list-channels\` to see available channels.)`
    );
  }
  return { id: match.id, name: match.name };
}

interface ConversationsInfoResponse extends ApiResponse {
  channel: SlackChannel;
}

async function conversationsInfo(channelId: string): Promise<SlackChannel> {
  const data = await call<ConversationsInfoResponse>('conversations.info', { channel: channelId });
  return data.channel;
}

interface HistoryResponse extends ApiResponse {
  messages: SlackMessage[];
  has_more: boolean;
}

export async function history(
  channelId: string,
  options: { oldest?: number; limit?: number } = {}
): Promise<SlackMessage[]> {
  const params: Record<string, string | number> = {
    channel: channelId,
    limit: options.limit ?? 100
  };
  if (options.oldest) params.oldest = options.oldest;
  const data = await call<HistoryResponse>('conversations.history', params);
  return data.messages;
}

interface RepliesResponse extends ApiResponse {
  messages: SlackMessage[];
}

export async function thread(channelId: string, thread_ts: string): Promise<SlackMessage[]> {
  const data = await call<RepliesResponse>('conversations.replies', {
    channel: channelId,
    ts: thread_ts,
    limit: 200
  });
  return data.messages;
}

interface UsersInfoResponse extends ApiResponse {
  user: SlackUser;
}

export async function userInfo(userId: string): Promise<SlackUser> {
  const data = await call<UsersInfoResponse>('users.info', { user: userId });
  return data.user;
}

interface SearchMessagesResponse extends ApiResponse {
  messages: {
    matches: Array<
      SlackMessage & {
        channel?: { id: string; name: string; is_im?: boolean; is_mpim?: boolean };
        permalink?: string;
      }
    >;
    total: number;
  };
}

export async function searchMessages(query: string, count = 50): Promise<SearchMessagesResponse['messages']> {
  const data = await call<SearchMessagesResponse>('search.messages', {
    query,
    count,
    sort: 'timestamp',
    sort_dir: 'desc'
  });
  return data.messages;
}
