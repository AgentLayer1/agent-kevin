import { writeDashboardHtml } from '@/status/html';
import { defineTool, type ToolDef } from '@/shared/types';
import { writeDashboard, type DashboardCounts } from '@/tasks/dashboard';

export const tools: ToolDef[] = [
  defineTool({
    name: 'status_dashboard',
    description:
      'Rebuild <HOME>/index.html — the static Agent OS dashboard — from a fresh status snapshot (runtime, knowledge, ' +
      'compile, tasks, context, settings, logs, health). Self-contained page, no server, zero external requests. ' +
      'Also rebuilds projects/TASKS.md first so the snapshot reads current task + goals state — the two derived ' +
      'views always refresh together. Run after task mutations so the snapshot reflects current state.',
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
