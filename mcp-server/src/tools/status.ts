import { stampSync } from '@/shared/cadence';
import { defineTool, type ToolDef } from '@/shared/types';
import { rebuildDashboards } from '@/status/html';
import { z } from 'zod';

export const tools: ToolDef[] = [
  defineTool({
    name: 'dashboard',
    description:
      'Rebuild both derived views in one pass: projects/TASKS.md (task dashboard from frontmatter — Active, Blocked, ' +
      'Overdue, Stale, Recently Closed; preserves the goals block) and <HOME>/dashboard.html (the static Agent OS ' +
      'dashboard from a fresh status snapshot). Self-contained, no server, zero external requests. Task mutations ' +
      'refresh both automatically; invoke explicitly to force a refresh.',
    inputSchema: {
      sync: z
        .boolean()
        .optional()
        .describe('Only the sync skill sets this: record the run as the last sync before rendering.')
    },
    handler: async ({ sync }) => {
      if (sync) {
        stampSync();
      }
      return rebuildDashboards();
    }
  })
];
