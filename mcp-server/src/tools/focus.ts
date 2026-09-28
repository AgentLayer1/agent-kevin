import { defineTool, type ToolDef } from '@/shared/types';
import { saveFocusQueue, writeFocusPage } from '@/status/focus';
import { FocusGroupSchema, focusData } from '@/status/focus-data';
import { rebuildDashboards } from '@/status/html';
import { z } from 'zod';

export const tools: ToolDef[] = [
  defineTool({
    name: 'focus_write',
    description:
      "Render a focus page (today, carried over, this week, this month, and a queue of what's waiting on the operator). " +
      'Without `project` it is the home page, <HOME>/focus.html, across every project; with one it is ' +
      'projects/<project>/focus.html, that project alone. The home page is a dashboard surface and a project page links ' +
      'from its project card; both re-render on every dashboard rebuild once they exist. Pass `queue` to replace that page’s cached queue (stamped with the fetch time); ' +
      "omit it to re-render with the last one. Tasks and goals are always read live. Returns the page path and the page's " +
      'data, the same JSON it embeds in its focus-data block: lanes, planned progress, roadmap milestones and queue.',
    inputSchema: {
      project: z.string().optional().describe('Project slug for a project page; omit for the home page.'),
      queue: z
        .array(FocusGroupSchema)
        .optional()
        .describe(
          'Queue groups in display order, each { label, empty, items }: e.g. "My pull requests", "Reviews I owe". ' +
            '`empty` is what the page says when the group has no items.'
        )
    },
    handler: async ({ project = '', queue }) => {
      if (queue) {
        saveFocusQueue(project, queue);
      }
      const { path, view } = writeFocusPage(project);
      await rebuildDashboards();
      return { path, ...focusData(view) };
    }
  })
];
