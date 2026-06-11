import { writeDashboardHtml } from '@/status/html';
import { defineTool, type ToolDef } from '@/shared/types';
import { writeDashboard, type DashboardCounts } from '@/tasks/dashboard';

export const tools: ToolDef[] = [
  defineTool({
    name: 'dashboard',
    description:
      'Rebuild both derived views in one pass: projects/TASKS.md (task dashboard from frontmatter — Active, Blocked, ' +
      'Overdue, Stale, Recently Closed; preserves the goals block) and <HOME>/index.html (the static Agent OS ' +
      'dashboard from a fresh status snapshot). Self-contained, no server, zero external requests. Task mutations ' +
      'refresh both automatically; invoke explicitly to force a refresh.',
    inputSchema: {},
    handler: async () => {
      let tasks: DashboardCounts | null = null;
      try {
        tasks = writeDashboard();
      } catch {
        // TASKS.md is best-effort here — the HTML snapshot is the contract
      }
      return { ...(await writeDashboardHtml()), tasks };
    }
  })
];
