#!/usr/bin/env bun
/**
 * Kevin MCP Server — entrypoint.
 * stdio transport; spawned by Claude Code on plugin enable.
 *
 * Boot is side-effect-free. Tools that write (compile state, OAuth tokens,
 * playwright captures) create their parent dirs at write time. Pre-init
 * plugins must not touch disk.
 */
import { FOLDERS, PLUGIN_NAME, isInitialized } from '@/config';
import { log } from '@/shared/log';
import { runtimeDirName } from '@/shared/naming';
import type { ToolDef } from '@/shared/types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOL_MODULES } from './tools/modules';

// Tool modules load from the shared TOOL_MODULES list so registration and
// the dashboard's capability listing can never drift. A broken module still
// fails the boot — Promise.all rejects before the server connects.
const TOOLS: ToolDef[] = (
  await Promise.all(TOOL_MODULES.map(async (name): Promise<{ tools: ToolDef[] }> => import(`./tools/${name}`)))
).flatMap((mod) => mod.tools);

const server = new McpServer({ name: 'kevin', version: '0.1.0' });

/**
 * Tools that run without an agent home, mirroring the CLI's exemptions.
 *
 * `ping` is a diagnostic — it has to answer, and answering includes saying the
 * home isn't one. The worktree verbs act on the repo path they're handed and
 * touch no home state (no `FOLDERS.*` in that module at all).
 *
 * Everything else is gated. Nearly every other tool reads or writes under the
 * home, and several — `video_frames` and the browser captures via
 * `.<data-dir>/browser`, OAuth tokens via `.<data-dir>/secrets` — would create
 * the data dir there, which is the marker that decides what counts as this
 * agent's home. Scaffolding it into the wrong tree makes that tree permanently
 * look like a home.
 */
const HOMELESS_OK = new Set(['ping', 'setup_worktree', 'list_worktrees', 'remove_worktree']);

for (const tool of TOOLS) {
  const toolLog = log.with(() => `tool:${tool.name}`);
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args) => {
    toolLog.debug('dispatch', args);
    try {
      if (!HOMELESS_OK.has(tool.name) && !isInitialized()) {
        toolLog.warn(`refused — ${FOLDERS.HOME} is not this agent's home`);
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Error: ${tool.name} needs an agent home, and ${FOLDERS.HOME} is not one ` +
                `(no ${runtimeDirName()}/ there). The home is resolved from the directory this ` +
                `session was launched in, so start Claude Code from the agent home — or run ` +
                `/${PLUGIN_NAME}:init there if it hasn't been set up yet.`
            }
          ],
          isError: true
        };
      }
      const result = await tool.handler(args);
      return {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }]
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLog.error(`failed: ${message}`);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });
}

await server.connect(new StdioServerTransport());
log.info(`kevin MCP server started — tools=${TOOLS.length}`);
