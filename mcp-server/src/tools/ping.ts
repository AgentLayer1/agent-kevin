import { FOLDERS, PLUGIN_VERSION, TIMEZONE, isInitialized } from '@/config';
import { defineTool, type ToolDef } from '@/shared/types';

export const tools: ToolDef[] = [
  defineTool({
    name: 'ping',
    description:
      'Health check — returns server status, the plugin version this server process loaded, and resolved paths.',
    inputSchema: {},
    // `ok` reports whether the resolved path is actually this agent's home,
    // which is what decides if every other tool will run. A hardcoded `true`
    // made the one diagnostic that exists to catch a misresolved home the one
    // thing that couldn't.
    handler: async () => ({
      ok: isInitialized(),
      // The version in memory, not on disk: after a code update the two differ until the
      // host restarts, and callers that spawn plugin scripts need to know which they have.
      version: PLUGIN_VERSION,
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
