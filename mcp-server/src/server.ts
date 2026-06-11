#!/usr/bin/env bun
/**
 * Kevin MCP Server — entrypoint.
 * stdio transport; spawned by Claude Code on plugin enable.
 *
 * Boot is side-effect-free. Tools that write (compile state, OAuth tokens,
 * playwright captures) create their parent dirs at write time. Pre-init
 * plugins must not touch disk.
 */
import { log } from '@/shared/log';
import type { ToolDef } from '@/shared/types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools as browserFlowsTools } from './tools/browser-flows';
import { tools as captureTools } from './tools/capture';
import { tools as compileTools } from './tools/compile';
import { tools as pageSpeedTools } from './tools/google-page-speed';
import { tools as gscTools } from './tools/google-search-console';
import { tools as knowledgeTools } from './tools/knowledge';
import { tools as openPageRankTools } from './tools/open-page-rank';
import { tools as perplexityTools } from './tools/perplexity';
import { tools as pingTools } from './tools/ping';
import { tools as playwrightTools } from './tools/playwright';
import { tools as reportTools } from './tools/reports';
import { tools as serpapiTools } from './tools/serpapi';
import { tools as statusTools } from './tools/status';
import { tools as taskTools } from './tools/tasks';

// google-auth.ts only exports OAuth helpers used by gsc + page-speed tools.
// The `google_auth` MCP tool itself is defined inside google-search-console.ts
// (it shares the same auth-flow code path), so no separate import needed here.

const TOOLS: ToolDef[] = [
  ...pingTools,
  ...taskTools,
  ...knowledgeTools,
  ...compileTools,
  ...captureTools,
  ...serpapiTools,
  ...perplexityTools,
  ...openPageRankTools,
  ...gscTools,
  ...pageSpeedTools,
  ...playwrightTools,
  ...reportTools,
  ...browserFlowsTools,
  ...statusTools
];

const server = new McpServer({ name: 'kevin', version: '0.1.0' });

for (const tool of TOOLS) {
  const toolLog = log.with(() => `tool:${tool.name}`);
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args) => {
    toolLog.debug('dispatch', args);
    try {
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
