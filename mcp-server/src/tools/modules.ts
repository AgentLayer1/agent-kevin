/**
 * Single source of truth for the tool modules under tools/ that export a
 * `tools: ToolDef[]` array. server.ts registers from this list; the status
 * collector lists capabilities from it — adding a module here wires both.
 * (google-auth.ts is absent on purpose: it only exports OAuth helpers; the
 * `google_auth` tool itself lives in google-search-console.ts.)
 */
export const TOOL_MODULES = [
  'browser',
  'browser-flows',
  'capture',
  'compile',
  'database',
  'database-fork',
  'github',
  'google-page-speed',
  'google-search-console',
  'knowledge',
  'open-page-rank',
  'ping',
  'reports',
  'serpapi',
  'status',
  'tasks',
  'upgrade',
  'video',
  'web-search',
  'worktree'
] as const;
