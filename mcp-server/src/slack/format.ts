/**
 * Output formatters — JSON (default) and markdown (Kevin-friendly).
 */
import type { FormattedMessage, SlackChannel, SlackMessage, SlackUser } from './types';

export type Format = 'json' | 'markdown';

export function parseFormat(value: string | undefined): Format {
  return value === 'markdown' ? 'markdown' : 'json';
}

/** Slack ts → ISO 8601 (UTC). Slack timestamps are seconds.microseconds. */
export function tsToIso(ts: string): string {
  const seconds = Number.parseFloat(ts);
  return new Date(seconds * 1000).toISOString();
}

export function resolveUserDisplay(userId: string | undefined, cache: Map<string, SlackUser>): string {
  if (!userId) return 'unknown';
  const user = cache.get(userId);
  if (!user) return userId;
  return user.profile?.display_name || user.real_name || user.name || userId;
}

export interface MessageContext {
  channelName: string;
  channelId: string;
  users: Map<string, SlackUser>;
}

export function formatMessage(msg: SlackMessage, ctx: MessageContext): FormattedMessage {
  const userDisplay = msg.bot_id ? msg.username || `bot:${msg.bot_id}` : resolveUserDisplay(msg.user, ctx.users);
  return {
    channel: ctx.channelName,
    channel_id: ctx.channelId,
    user: userDisplay,
    ts: msg.ts,
    iso: tsToIso(msg.ts),
    text: msg.text,
    thread_ts: msg.thread_ts !== msg.ts ? msg.thread_ts : undefined,
    reply_count: msg.reply_count
  };
}

export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function renderChannelsMarkdown(channels: SlackChannel[]): string {
  return channels
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `- ${c.is_private ? '🔒 ' : ''}#${c.name}${c.topic?.value ? ` — ${c.topic.value}` : ''}`)
    .join('\n');
}

export function renderMessagesMarkdown(messages: FormattedMessage[]): string {
  if (messages.length === 0) return '_(no messages)_';
  const lines: string[] = [];
  for (const m of messages) {
    const thread = m.reply_count ? ` _(thread: ${m.reply_count} replies)_` : '';
    lines.push(`**${m.user}** · #${m.channel} · ${m.iso}${thread}`);
    lines.push(m.text.replace(/^/gm, '> '));
    lines.push('');
  }
  return lines.join('\n');
}
