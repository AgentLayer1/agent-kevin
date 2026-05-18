import { FOLDERS, TIMEZONE } from '@/config';
import { defineTool, type ToolDef } from '@/shared/types';

export const tools: ToolDef[] = [
  defineTool({
    name: 'ping',
    description: 'Health check — returns server status and resolved paths.',
    inputSchema: {},
    handler: async () => ({
      ok: true,
      time: new Date().toISOString(),
      timezone: TIMEZONE,
      paths: {
        home: FOLDERS.HOME,
        knowledge: FOLDERS.KNOWLEDGE,
        projects: FOLDERS.PROJECTS,
        data: FOLDERS.DATA
      }
    })
  })
];
