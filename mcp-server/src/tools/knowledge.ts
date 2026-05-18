/**
 * Knowledge MCP tools — mechanical operations only (no LLM).
 * LLM-orchestrated tools live in `./compile`.
 */
import { rewriteAllWikilinks } from '@/knowledge/links';
import { run as runLint } from '@/knowledge/lint';
import { pruneMemory } from '@/knowledge/prune';
import { defineTool, type ToolDef } from '@/shared/types';
import { z } from 'zod';

export const tools: ToolDef[] = [
  defineTool({
    name: 'memory_prune',
    description: 'Delete daily memory files older than the retention window (default 14 days).',
    inputSchema: {},
    handler: async () => {
      await pruneMemory();
      return { ok: true };
    }
  }),
  defineTool({
    name: 'links_rewrite',
    description: 'Normalize bare task IDs and shorthand references into [[wikilinks]] across the knowledge base.',
    inputSchema: {},
    handler: async () => {
      const modified = await rewriteAllWikilinks();
      return { modified, count: modified.length };
    }
  }),
  defineTool({
    name: 'knowledge_lint',
    description:
      'Run structural health checks across the wiki (broken links, orphan pages, orphan sources, missing backlinks, sparse articles, transient memory refs in permanent articles, invalid frontmatter). Writes a report to .kevin/lint.md. Pass fix:true to auto-rewrite stale wikilinks and insert missing backlinks.',
    inputSchema: {
      fix: z.boolean().optional().describe('Run auto-fix pass (default false)')
    },
    handler: async ({ fix }) => runLint({ fixMode: fix ?? false })
  })
];
