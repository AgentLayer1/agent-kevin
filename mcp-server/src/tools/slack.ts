import {
  getBatchHistory,
  getChannels,
  getHistory,
  getThread,
  getWhoami,
  parseThreadUrl,
  searchSlack,
  writeBatchDir
} from '@/slack/operations';
import { getWaiting } from '@/slack/waiting';
import { defineTool, type ToolDef } from '@/shared/types';
import { z } from 'zod';
import { pluginName } from '@/shared/naming';

const AGENT_CLI = pluginName().replace(/^agent-/, '');

const SINCE = z
  .string()
  .regex(/^\d+[hdwm]$/, 'Use Nh / Nd / Nw / Nm (hours/days/weeks/months)')
  .describe('Lookback window: Nh / Nd / Nw / Nm. Default: most recent messages, no time bound.');

export const tools: ToolDef[] = [
  defineTool({
    name: 'slack_whoami',
    description: `Verify Slack access and return the authenticated identity (user, team, scopes, token expiry). Read-only. Runs inside the MCP server, so it reads the deny-gated token file that a sandboxed \`${AGENT_CLI} slack\` shell cannot.`,
    inputSchema: {},
    handler: async () => getWhoami()
  }),
  defineTool({
    name: 'slack_channels',
    description: 'List the Slack channels the operator is a member of (sorted by name). Read-only.',
    inputSchema: {},
    handler: async () => getChannels()
  }),
  defineTool({
    name: 'slack_history',
    description:
      'Fetch recent messages from one Slack channel (by #name or channel ID). Read-only. Use `since` and `limit` to bound the window.',
    inputSchema: {
      channel: z.string().min(1).describe('Channel #name or ID (e.g. "customer-support" or "C0123ABCD").'),
      since: SINCE.optional(),
      limit: z.number().int().positive().max(1000).optional().describe('Max messages to return. Default 100.')
    },
    handler: async (args) => getHistory(args)
  }),
  defineTool({
    name: 'slack_thread',
    description:
      'Fetch a full Slack thread (root message + replies). Pass either a message `url` (…/archives/<channel>/p<ts>) OR `channel` + `thread_ts`. Read-only.',
    inputSchema: {
      url: z.string().url().optional().describe('Slack message permalink — channel and timestamp are parsed from it.'),
      channel: z.string().optional().describe('Channel #name or ID. Required when `url` is omitted.'),
      thread_ts: z
        .string()
        .optional()
        .describe('Thread root timestamp, e.g. "1782346438.941609". Required when `url` is omitted.')
    },
    handler: async (args) => {
      const target = args.url ? parseThreadUrl(args.url) : { channel: args.channel, thread_ts: args.thread_ts };
      if (!target.channel || !target.thread_ts) {
        throw new Error('Provide either `url`, or both `channel` and `thread_ts`.');
      }
      return getThread({ channel: target.channel, thread_ts: target.thread_ts });
    }
  }),
  defineTool({
    name: 'slack_search',
    description:
      'Search Slack messages across the workspace. Read-only. `in` scopes to a single channel; `since` adds an after:<date> filter.',
    inputSchema: {
      query: z.string().min(1).describe('Search text (Slack search syntax allowed).'),
      in: z.string().optional().describe('Scope to a single channel #name.'),
      since: SINCE.optional()
    },
    handler: async (args) => searchSlack(args)
  }),
  defineTool({
    name: 'slack_batch_history',
    description:
      'Fetch recent messages from many Slack channels in one parallel call. Read-only. For large scans pass `outDir` to write one JSON file per channel and return only a compact summary, avoiding an oversized response.',
    inputSchema: {
      channels: z.array(z.string().min(1)).min(1).describe('Channel #names or IDs.'),
      since: SINCE.optional(),
      limit: z.number().int().positive().max(1000).optional().describe('Max messages per channel. Default 100.'),
      outDir: z
        .string()
        .optional()
        .describe('If set, write one <channel>.json per channel here and return a summary instead of inline messages.')
    },
    handler: async (args) => {
      const batch = await getBatchHistory(args);
      if (args.outDir) {
        const written = await writeBatchDir(batch, args.outDir, 'json');
        return { requested: batch.requested, resolved: batch.resolved, missing: batch.missing, written };
      }
      return batch;
    }
  }),
  defineTool({
    name: 'slack_waiting',
    description:
      "What Slack is waiting on, read-only: `external`, threads in the given channels whose last word is from outside the workspace (another organization in a shared channel, or a guest) and has waited at least `after` minutes with no reply or reaction from the workspace; `mentions`, mentions of the operator anywhere in the workspace they haven't replied to in that time; and `unmapped`, channels the operator is in that the channel map (knowledge/concepts/slack-channels.md) doesn't list (null when there is no map yet). A bot's post, an auto-acknowledgement included, doesn't count as a reply, and a thread is never in both lists. Returns channel, author, wait and a link, never message text, so it's safe unattended; open a thread with slack_thread when its content matters.",
    inputSchema: {
      channels: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'External channel #names or IDs to check for threads waiting on the workspace. Omit for mentions only.'
        ),
      since: SINCE.optional().describe('How far back to look for threads and mentions. Default 7d.'),
      after: z.number().int().positive().optional().describe('Minutes a message must have waited to count. Default 60.')
    },
    handler: async (args) => getWaiting(args)
  })
];
