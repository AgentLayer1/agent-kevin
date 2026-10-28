/**
 * Shared read-only Slack orchestration — channel resolution, user-name
 * hydration, and message formatting on top of the raw `client.ts` primitives.
 *
 * Both entry points consume these: the `kevin slack` CLI (cli.ts, wraps the
 * results in stdout rendering) and the `slack_*` MCP tools (tools/slack.ts,
 * return the structured results directly). Keeping the orchestration here means
 * the two surfaces can never drift — and the MCP tools run inside the
 * unsandboxed server process, so they read the deny-gated token file that a
 * sandboxed `kevin slack` shell cannot.
 */
import { pluginName } from '@/shared/naming';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as slack from './client';
import { slackTokensFile } from './config';
import { formatMessage, renderJson, renderMessagesMarkdown, type Format, type MessageContext } from './format';
import { loadTokens } from './oauth';
import type { FormattedMessage, SlackChannel, SlackUser } from './types';

const SECONDS_PER_UNIT: Record<string, number> = { h: 3600, d: 86400, w: 604800, m: 2592000 };

/** Parse an `Nh`/`Nd`/`Nw`/`Nm` lookback into an absolute epoch-second `oldest` bound. */
export function parseSince(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+)([hdwm])$/.exec(value);
  if (!match) {
    throw new Error(`Invalid since value: ${value}. Use Nh / Nd / Nw / Nm (hours/days/weeks/months).`);
  }
  return Math.floor(Date.now() / 1000) - Number(match[1]) * SECONDS_PER_UNIT[match[2]];
}

/** Parse a Slack message permalink (.../archives/<channel>/p<ts>) into channel + thread root ts. */
export function parseThreadUrl(url: string): { channel: string; thread_ts: string } {
  const parsed = new URL(url);
  const match = /\/archives\/([A-Z0-9]+)\/p(\d+)/i.exec(parsed.pathname);
  if (!match) {
    throw new Error(`Not a Slack message URL: ${url}. Expected .../archives/<channel>/p<timestamp>.`);
  }
  // Permalinks drop the decimal: p1767225600000100 → 1767225600.000100.
  const messageTs = `${match[2].slice(0, -6)}.${match[2].slice(-6)}`;
  // A reply link carries the root ts in the query — prefer it so we fetch the whole thread.
  return { channel: match[1], thread_ts: parsed.searchParams.get('thread_ts') ?? messageTs };
}

/** Resolve a set of user IDs to their info in parallel, dropping any that fail to look up. */
export async function buildUserCache(userIds: Iterable<string>): Promise<Map<string, SlackUser>> {
  const ids = Array.from(new Set(userIds)).filter(Boolean);
  const pairs = await Promise.all(
    ids.map(async (id) => {
      try {
        return [id, await slack.userInfo(id)] as const;
      } catch {
        return null;
      }
    })
  );
  return new Map(pairs.filter((pair): pair is readonly [string, SlackUser] => pair !== null));
}

export interface ChannelHistory {
  channel: string;
  channel_id: string;
  count: number;
  messages: FormattedMessage[];
}

export interface BatchHistory {
  requested: number;
  resolved: number;
  missing: string[];
  channels: ChannelHistory[];
}

async function hydrate(
  resolved: { id: string; name: string },
  messages: Awaited<ReturnType<typeof slack.history>>
): Promise<ChannelHistory> {
  const users = await buildUserCache(messages.map((message) => message.user).filter(Boolean) as string[]);
  const ctx: MessageContext = { channelName: resolved.name, channelId: resolved.id, users };
  const formatted = messages.map((message) => formatMessage(message, ctx));
  return { channel: resolved.name, channel_id: resolved.id, count: formatted.length, messages: formatted };
}

export async function getHistory(opts: { channel: string; since?: string; limit?: number }): Promise<ChannelHistory> {
  const resolved = await slack.resolveChannelId(opts.channel);
  const messages = await slack.history(resolved.id, { oldest: parseSince(opts.since), limit: opts.limit ?? 100 });
  return hydrate(resolved, messages);
}

export async function getThread(opts: { channel: string; thread_ts: string }): Promise<ChannelHistory> {
  const resolved = await slack.resolveChannelId(opts.channel);
  const messages = await slack.thread(resolved.id, opts.thread_ts);
  return hydrate(resolved, messages);
}

/** Resolve `#names` and ids to channels; names that match nothing come back in `missing`. */
export async function resolveChannels(
  channels: readonly string[],
  membership?: readonly SlackChannel[]
): Promise<{
  resolved: Array<{ id: string; name: string }>;
  missing: string[];
}> {
  const inputs = channels.map((name) => name.trim().replace(/^#/, '')).filter(Boolean);

  // One list-channels call resolves every name in the batch — vs N separate
  // resolveChannelId() calls that would each re-paginate the full workspace.
  const allChannels = membership ?? (await slack.listChannels());
  const byName = new Map(allChannels.map((channel) => [channel.name, channel]));
  const resolved: Array<{ id: string; name: string }> = [];
  const missing: string[] = [];
  for (const input of inputs) {
    if (/^[CG][A-Z0-9]+$/.test(input)) {
      resolved.push({ id: input, name: input });
    } else {
      const found = byName.get(input);
      if (found) resolved.push({ id: found.id, name: found.name });
      else missing.push(input);
    }
  }
  return { resolved, missing };
}

export async function getBatchHistory(opts: {
  channels: string[];
  since?: string;
  limit?: number;
}): Promise<BatchHistory> {
  const oldest = parseSince(opts.since);
  const limit = opts.limit ?? 100;
  const { resolved, missing } = await resolveChannels(opts.channels);

  // Parallel history fetch (Slack tier-3 limit is 50+/min — safe for batches ≤ 40).
  const histories = await Promise.all(
    resolved.map(async (channel) => ({ channel, messages: await slack.history(channel.id, { oldest, limit }) }))
  );
  const users = await buildUserCache(
    histories.flatMap((entry) => entry.messages.map((message) => message.user).filter(Boolean) as string[])
  );
  const channels = histories.map((entry) => {
    const ctx: MessageContext = { channelName: entry.channel.name, channelId: entry.channel.id, users };
    const formatted = entry.messages.map((message) => formatMessage(message, ctx));
    return { channel: entry.channel.name, channel_id: entry.channel.id, count: formatted.length, messages: formatted };
  });
  return { requested: resolved.length + missing.length, resolved: resolved.length, missing, channels };
}

export async function searchSlack(opts: { query: string; in?: string; since?: string }) {
  let scopedQuery = opts.query;
  if (opts.in) scopedQuery = `${scopedQuery} in:#${opts.in.replace(/^#/, '')}`;
  if (opts.since) {
    const sinceTs = parseSince(opts.since);
    if (sinceTs) scopedQuery = `${scopedQuery} after:${new Date(sinceTs * 1000).toISOString().slice(0, 10)}`;
  }
  const results = await slack.searchMessages(scopedQuery, 50);
  return { query: scopedQuery, total: results.total, matches: results.matches };
}

export async function getChannels(): Promise<SlackChannel[]> {
  const channels = await slack.listChannels();
  return channels.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export interface SignedIn {
  connected: true;
  user: string;
  user_id: string;
  team: string;
  team_id: string;
  scope: string;
  authed_at: string;
  expires_at: string;
}

/**
 * `connected: false` means this agent was never signed in to Slack, so callers can skip Slack quietly;
 * a sign-in that fails (expired, revoked, rate-limited) still throws.
 */
export type Whoami = SignedIn | { connected: false; hint: string };

export async function getWhoami(): Promise<Whoami> {
  if (!existsSync(slackTokensFile())) {
    const cli = pluginName().replace(/^agent-/, '');
    return { connected: false, hint: `No Slack sign-in yet. Run \`${cli} slack auth\` from your own terminal.` };
  }
  const tokens = loadTokens();
  const me = await slack.authTest();
  return {
    connected: true,
    user: me.user,
    user_id: me.user_id,
    team: me.team,
    team_id: me.team_id,
    scope: tokens.scope,
    authed_at: tokens.authed_at,
    expires_at: new Date(tokens.expires_at * 1000).toISOString()
  };
}

export interface WrittenFile {
  channel: string;
  count: number;
  path: string;
}

/** Write one channel's history to a file, returning a compact summary instead of the messages. */
export async function writeHistoryFile(history: ChannelHistory, path: string, format: Format): Promise<WrittenFile> {
  const content =
    format === 'markdown' ? renderMessagesMarkdown(history.messages) + '\n' : renderJson(history.messages) + '\n';
  await writeFile(path, content, 'utf8');
  return { channel: history.channel, count: history.count, path };
}

/**
 * Write each channel of a batch to its own file in `dir`. Filenames are the
 * channel name (globally unique, so parallel agents never collide) so a big
 * multi-channel scan returns a small summary instead of megabytes of messages.
 */
export async function writeBatchDir(batch: BatchHistory, dir: string, format: Format): Promise<WrittenFile[]> {
  await mkdir(dir, { recursive: true });
  const ext = format === 'markdown' ? 'md' : 'json';
  return Promise.all(
    batch.channels.map(async (channel) => {
      const file = join(dir, `${channel.channel}.${ext}`);
      const content =
        format === 'markdown'
          ? `# #${channel.channel} (${channel.count})\n\n${renderMessagesMarkdown(channel.messages)}\n`
          : renderJson(channel) + '\n';
      await writeFile(file, content, 'utf8');
      return { channel: channel.channel, count: channel.count, path: file };
    })
  );
}
