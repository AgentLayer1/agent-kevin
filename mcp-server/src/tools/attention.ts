import { FILES } from '@/config';
import { defineTool, type ToolDef } from '@/shared/types';
import { collectAttentionView, saveAttentionQueue, writeAttentionPage } from '@/status/attention';
import { AttentionGroupSchema, attentionData } from '@/status/attention-data';
import { rebuildDashboards } from '@/status/html';
import { z } from 'zod';

export const tools: ToolDef[] = [
  defineTool({
    name: 'attention_write',
    description:
      "Render attention (today, carried over, this week, this month, the roadmap in flight, and a queue of what's waiting on the " +
      "operator). Without `project` it is the home view across every project: the dashboard's Today → Attention tab, which " +
      'dashboard.html also embeds as an attention-data block. With one it is projects/<project>/attention.html, that project alone, ' +
      'linked from its project card; it re-renders on every dashboard rebuild once it exists. Pass `queue` to replace that ' +
      "scope's cached queue (stamped with the fetch time); omit it to re-render with the last one. Tasks, goals and roadmaps " +
      'are always read live. Returns where to look (`path`) and the attention data: lanes, planned progress, roadmap milestones ' +
      'and queue.',
    inputSchema: {
      project: z.string().optional().describe('Project slug for a project page; omit for the home view in the dashboard.'),
      queue: z
        .array(AttentionGroupSchema)
        .optional()
        .describe(
          'Queue groups in display order, each { label, empty, items, unavailable? }: e.g. "My pull requests", ' +
            '"Reviews I owe". `empty` is what the page says when the group has no items; `unavailable` says, once, what ' +
            "couldn't be read."
        )
    },
    handler: async ({ project = '', queue }) => {
      if (queue) {
        saveAttentionQueue(project, queue);
      }
      const page = project ? writeAttentionPage(project) : null;
      await rebuildDashboards();
      const view = page ? page.view : collectAttentionView('');
      return { path: page ? page.path : FILES.DASHBOARD, ...attentionData(view) };
    }
  })
];
