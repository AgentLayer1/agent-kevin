/**
 * Compile MCP tools — skill-orchestrated knowledge compilation.
 *
 * Pattern: skill loops over `compile_next`, performs the synthesis itself
 * (using Read/Write/Edit in the parent CC TUI session, billing against
 * subscription), then confirms via `compile_write`. The MCP server never
 * calls the LLM — pure I/O and state.
 */
import { getStatus, markComplete, pickNext } from '@/knowledge/compile';
import { log as baseLog } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { z } from 'zod';

const log = baseLog.knowledge.with('compile');

export const tools: ToolDef[] = [
  defineTool({
    name: 'compile_status',
    description: 'How many raw items are pending compilation (sessions/feedback/inbox).',
    inputSchema: {},
    handler: async () => getStatus()
  }),
  defineTool({
    name: 'compile_next',
    description:
      'Return the next compile work item: a rendered prompt + source content + metadata. Caller synthesises wiki articles per the prompt (using Read/Write/Edit), then confirms via compile_write. Returns { done: true } when nothing pending.',
    inputSchema: {},
    // A chunk plus its task section passes Claude Code's 25K-token default, which parks the result in a file the caller must page through.
    meta: { 'anthropic/maxResultSizeChars': 200_000 },
    handler: async () => {
      const item = await pickNext();
      if (item) log.info(`next → ${item.itemId} (${item.kind})`);
      else log.info('next → done (nothing pending)');
      return item ? { done: false, item } : { done: true, item: null };
    }
  }),
  defineTool({
    name: 'compile_write',
    description: 'Mark a compile work item complete. Persists state — promotes to ingested or advances chunk counter.',
    inputSchema: {
      itemId: z.string().describe('Opaque ID returned by compile_next, e.g. "session:2026-05-16.md:0"')
    },
    handler: async ({ itemId }) => {
      const result = await markComplete(itemId);
      log.info(`write ← ${itemId}`);
      return result;
    }
  })
];
