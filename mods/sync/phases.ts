// Pure data and reducers, no 'claude-code' import: mcp-server's bun suite imports this file to
// check the table against skills/sync/SKILL.md.

interface Phase {
  id: string;
  tools: readonly string[];
  scripts: readonly string[];
  skills: readonly string[];
  reports: readonly ReportMatch[];
}

interface ReportMatch {
  category: string;
  skill?: string;
}

interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
}

const phase = (id: string, parts: Partial<Omit<Phase, 'id'>>): Phase => ({
  id,
  tools: parts.tools ?? [],
  scripts: parts.scripts ?? [],
  skills: parts.skills ?? [],
  reports: parts.reports ?? []
});

/**
 * Sync's steps in order, keyed by the tools and scripts each one calls.
 */
export const PHASES: readonly Phase[] = [
  phase('code', { tools: ['github_fast_forward'] }),
  phase('compile', { tools: ['compile_status', 'compile_next', 'compile_write'] }),
  phase('lint', { tools: ['knowledge_lint'] }),
  phase('prune', { tools: ['memory_prune'] }),
  phase('links', { tools: ['links_rewrite'] }),
  phase('flywheel', {
    tools: ['task_query', 'task_get', 'task_update', 'task_thread', 'task_close', 'task_create'],
    reports: [{ category: 'briefings', skill: 'flywheel' }]
  }),
  phase('attention', { tools: ['task_scan'], scripts: ['cadence.ts', 'brain-audit.ts'] }),
  phase('briefing', {
    tools: ['focus_write', 'web_search', 'WebSearch'],
    reports: [{ category: 'briefings' }]
  }),
  phase('radar', { skills: ['focus'], reports: [{ category: 'radar' }] }),
  phase('dashboard', { tools: ['dashboard'] }),
  phase('history', { scripts: ['commit-brain.ts'] }),
  phase('next', {
    tools: ['AskUserQuestion'],
    scripts: ['review-defer.ts'],
    skills: ['goals', 'self-review']
  })
];

/**
 * A call's bare tool name: the part after `__` for this plugin's MCP tools, the name itself otherwise.
 */
export const bareToolName = (tool: string, pluginName: string): string =>
  tool.startsWith(`mcp__plugin_${pluginName}_`) ? tool.slice(tool.lastIndexOf('__') + 2) : tool;

const scriptIn = (command: unknown): string | undefined =>
  typeof command === 'string' ? /\/scripts\/([\w-]+\.ts)/.exec(command)?.[1] : undefined;

const skillIn = (skill: unknown): string | undefined =>
  typeof skill === 'string' ? skill.slice(skill.indexOf(':') + 1) : undefined;

const reportMatches = (match: ReportMatch, input: Record<string, unknown>): boolean =>
  input.category === match.category && (match.skill === undefined || input.skill === match.skill);

const phaseMatches = (candidate: Phase, name: string, input: Record<string, unknown>): boolean => {
  if (name === 'Bash') {
    const script = scriptIn(input.command);
    return script !== undefined && candidate.scripts.includes(script);
  }
  if (name === 'Skill') {
    const skill = skillIn(input.skill);
    return skill !== undefined && candidate.skills.includes(skill);
  }
  if (name === 'report_write') {
    return candidate.reports.some((match) => reportMatches(match, input));
  }
  return candidate.tools.includes(name);
};

/**
 * The first phase whose signals match the call, or undefined. The flywheel's report names its
 * skill and comes first, so it is never read as the briefing.
 */
export const classify = (call: ToolCall, pluginName: string): number | undefined => {
  const name = bareToolName(call.tool, pluginName);
  const index = PHASES.findIndex((candidate) => phaseMatches(candidate, name, call.input));
  return index === -1 ? undefined : index;
};
