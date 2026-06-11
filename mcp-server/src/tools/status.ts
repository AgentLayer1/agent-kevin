import { writeDashboardHtml } from '@/status/html';
import { defineTool, type ToolDef } from '@/shared/types';

export const tools: ToolDef[] = [
  defineTool({
    name: 'status_dashboard',
    description:
      'Rebuild <HOME>/index.html — the static Agent OS dashboard — from a fresh status snapshot (runtime, knowledge, ' +
      'compile, tasks, context, settings, logs, health). Self-contained page, no server, zero external requests. ' +
      'Sibling of task_dashboard; run after task mutations so the snapshot reflects current state.',
    inputSchema: {},
    handler: async () => writeDashboardHtml()
  })
];
