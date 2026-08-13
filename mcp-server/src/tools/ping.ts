import { FOLDERS, TIMEZONE, isInitialized } from '@/config';
import { defineTool, type ToolDef } from '@/shared/types';

export const tools: ToolDef[] = [
  defineTool({
    name: 'ping',
    description: 'Health check — returns server status and resolved paths.',
    inputSchema: {},
    // `ok` reports whether the resolved path is actually this agent's home,
    // which is what decides if every other tool will run. A hardcoded `true`
    // made the one diagnostic that exists to catch a misresolved home the one
    // thing that couldn't.
    handler: async () => ({
      ok: isInitialized(),
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
