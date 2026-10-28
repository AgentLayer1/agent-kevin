/**
 * `kevin slack` subcommands — read-only Slack access for agent-kevin.
 *
 *   kevin slack auth                                  One-time per-operator OAuth (PKCE)
 *   kevin slack whoami                                Print authenticated Slack identity
 *   kevin slack list-channels                         List channels operator is a member of
 *   kevin slack history <channel> [--since=24h] [--limit=100] [--out=<file>]
 *   kevin slack batch-history <ch1,ch2,...> [--since=24h] [--limit=100] [--out=<dir>]
 *   kevin slack thread <channel> <thread_ts>
 *   kevin slack search <query> [--in=<channel>] [--since=7d]
 *
 * Global flag: --format=json|markdown (default: json)
 *
 * All operations are read-only. CLI exposes NO subcommands that post, write,
 * or read DMs (token scope also excludes DM and write capabilities).
 *
 * Categorisation is intentionally NOT here — it lives as operator-curated
 * markdown at `<HOME>/knowledge/concepts/slack-channels.md`, read by the
 * `slack` skill. The CLI exposes primitives only; multi-channel composition
 * happens in the skill.
 */
import { log as baseLog } from '@/shared/log';
import * as slack from './client';
import { parseFormat, renderChannelsMarkdown, renderJson, renderMessagesMarkdown, type Format } from './format';
import {
  getBatchHistory,
  getChannels,
  getHistory,
  getThread,
  getWhoami,
  searchSlack,
  writeBatchDir,
  writeHistoryFile
} from './operations';
import { runAuthFlow } from './oauth';
import { pluginName } from '@/shared/naming';

const AGENT_CLI = pluginName().replace(/^agent-/, '');

const log = baseLog.slack.with('cli');

function parseFlag(args: string[], name: string): string | undefined {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

function out(value: unknown, format: Format, mdRenderer?: () => string): void {
  if (format === 'markdown' && mdRenderer) {
    process.stdout.write(mdRenderer() + '\n');
  } else {
    process.stdout.write(renderJson(value) + '\n');
  }
}

export const SLACK_HELP = `\
${AGENT_CLI} slack — Read-only Slack access for ${pluginName()}

Usage:
  ${AGENT_CLI} slack <command> [args] [flags]

Commands:
  auth                                One-time per-operator OAuth (PKCE)
  whoami                              Show authenticated Slack identity
  list-channels                       List channels you're a member of (name, id, topic)
  history <channel> [--since=24h] [--limit=100] [--out=<file>]
  batch-history <ch1,ch2,...> [--since=24h] [--limit=100] [--out=<dir>]
                                      Multi-channel history in one process (parallel; for skills doing multi-channel scans)
  thread <channel> <thread_ts>
  search <query> [--in=<channel>] [--since=7d]

Global flags:
  --format=json|markdown  Output format (default: json)
  --out=<path>            Write output to disk instead of stdout; prints a compact
                          {channel, count, path} summary. batch-history writes one
                          <channel>.<ext> file per channel into the given dir. Use this
                          for large multi-channel scans — a full batch can exceed a
                          tool's stdout buffer and truncate.

Categorisation lives in <HOME>/knowledge/concepts/slack-channels.md — operator-curated
markdown read by the /${pluginName()}:slack skill for multi-channel composition.

Setup:
  /${pluginName()}:configure-skills → Slack creates the Slack app and runs the per-operator auth.
`;

async function cmdAuth(): Promise<void> {
  const tokens = await runAuthFlow();
  const me = await slack.authTest();
  log.info(`authenticated as @${me.user} (${me.user_id}) in workspace ${me.team}`);
  out(
    { ok: true, user: me.user, user_id: me.user_id, team: me.team, team_id: me.team_id, authed_at: tokens.authed_at },
    'json'
  );
}

async function cmdWhoami(format: Format): Promise<void> {
  const me = await getWhoami();
  if (!me.connected) {
    out(me, format, () => me.hint);
    return;
  }
  log.info(`whoami → @${me.user} (${me.user_id}) in ${me.team}`);
  out(me, format, () => `@${me.user} (${me.user_id}) — ${me.team}\nScopes: ${me.scope}`);
}

async function cmdListChannels(_args: string[], format: Format): Promise<void> {
  const channels = await getChannels();
  log.info(`list-channels → ${channels.length} channels`);
  out(channels, format, () => renderChannelsMarkdown(channels));
}

async function cmdHistory(args: string[], format: Format): Promise<void> {
  const channelArg = args[0];
  if (!channelArg)
    throw new Error(`Usage: ${AGENT_CLI} slack history <channel> [--since=24h] [--limit=100] [--out=<file>]`);
  const limitFlag = parseFlag(args, 'limit');
  const sinceFlag = parseFlag(args, 'since');
  const history = await getHistory({
    channel: channelArg,
    since: sinceFlag,
    limit: limitFlag ? Number(limitFlag) : undefined
  });
  log.info(`history #${history.channel} → ${history.count} messages${sinceFlag ? ` (since=${sinceFlag})` : ''}`);

  // --out=<file> writes the history to disk and prints a compact summary instead
  // of dumping (potentially megabytes of) messages to stdout.
  const outPath = parseFlag(args, 'out');
  if (outPath) {
    const summary = await writeHistoryFile(history, outPath, format);
    out(summary, format, () => `- ${summary.channel} (${summary.count}) → ${summary.path}`);
    return;
  }

  out(history.messages, format, () => renderMessagesMarkdown(history.messages));
}

async function cmdBatchHistory(args: string[], format: Format): Promise<void> {
  const channelsArg = args[0];
  if (!channelsArg) {
    throw new Error(`Usage: ${AGENT_CLI} slack batch-history <ch1,ch2,...> [--since=24h] [--limit=100] [--out=<dir>]`);
  }
  const limitFlag = parseFlag(args, 'limit');
  const sinceFlag = parseFlag(args, 'since');
  const batch = await getBatchHistory({
    channels: channelsArg.split(','),
    since: sinceFlag,
    limit: limitFlag ? Number(limitFlag) : undefined
  });
  const totalMessages = batch.channels.reduce((sum, channel) => sum + channel.count, 0);
  log.info(
    `batch-history → ${batch.resolved}/${batch.requested} channels, ${totalMessages} messages${sinceFlag ? ` (since=${sinceFlag})` : ''}${batch.missing.length ? `, missing=[${batch.missing.join(',')}]` : ''}`
  );

  // --out=<dir> writes one file per channel and prints only a compact summary.
  // A full batch can be >1 MB of markdown — enough to truncate in a tool's stdout
  // buffer — so callers scanning many channels (the slack skill's pulse) should always
  // pass --out and then read the per-channel files.
  const outDir = parseFlag(args, 'out');
  if (outDir) {
    const written = await writeBatchDir(batch, outDir, format);
    out({ requested: batch.requested, resolved: batch.resolved, missing: batch.missing, written }, format, () =>
      [
        ...written.map((entry) => `- ${entry.channel} (${entry.count}) → ${entry.path}`),
        ...(batch.missing.length ? [`missing: ${batch.missing.join(', ')}`] : [])
      ].join('\n')
    );
    return;
  }

  out(batch, format, () =>
    batch.channels
      .filter((channel) => channel.count > 0)
      .map((channel) => `# #${channel.channel} (${channel.count})\n\n${renderMessagesMarkdown(channel.messages)}`)
      .join('\n\n---\n\n')
  );
}

async function cmdThread(args: string[], format: Format): Promise<void> {
  const channelArg = args[0];
  const threadTs = args[1];
  if (!channelArg || !threadTs) {
    throw new Error(`Usage: ${AGENT_CLI} slack thread <channel> <thread_ts>`);
  }
  const thread = await getThread({ channel: channelArg, thread_ts: threadTs });
  log.info(`thread #${thread.channel}/${threadTs} → ${thread.count} messages`);
  out(thread.messages, format, () => renderMessagesMarkdown(thread.messages));
}

async function cmdSearch(args: string[], format: Format): Promise<void> {
  const query = args[0];
  if (!query) throw new Error(`Usage: ${AGENT_CLI} slack search <query> [--in=<channel>] [--since=7d]`);
  const result = await searchSlack({ query, in: parseFlag(args, 'in'), since: parseFlag(args, 'since') });
  log.info(`search "${result.query}" → ${result.matches.length}/${result.total} matches`);
  out(
    result,
    format,
    () =>
      `Query: \`${result.query}\` — ${result.total} total\n\n` +
      result.matches
        .map((m) => `**${m.username ?? m.user ?? 'unknown'}** · #${m.channel?.name ?? '?'} · ${m.ts}\n> ${m.text}\n`)
        .join('\n')
  );
}

export async function runSlackCommand(command: string | undefined, args: string[]): Promise<void> {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(SLACK_HELP);
    return;
  }
  const format = parseFormat(parseFlag(args, 'format'));
  log.debug(`dispatch ${command} ${args.join(' ')}`);

  try {
    switch (command) {
      case 'auth':
        await cmdAuth();
        break;
      case 'whoami':
        await cmdWhoami(format);
        break;
      case 'list-channels':
        await cmdListChannels(args, format);
        break;
      case 'history':
        await cmdHistory(args, format);
        break;
      case 'batch-history':
        await cmdBatchHistory(args, format);
        break;
      case 'thread':
        await cmdThread(args, format);
        break;
      case 'search':
        await cmdSearch(args, format);
        break;
      default:
        process.stderr.write(`Unknown slack command: ${command}\n\n${SLACK_HELP}`);
        process.exit(2);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`${command} failed: ${message}`, err);
    process.stderr.write(`${AGENT_CLI} slack ${command}: ${message}\n`);
    process.exit(1);
  }
}
