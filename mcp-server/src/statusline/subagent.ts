/**
 * Row bodies for the subagent panel: name, what the subagent is doing, and how much of its
 * context window it has used, on the same colour scale as the main status line. Claude Code
 * sends every visible row at once and takes one JSON line back per row to override.
 */
import { contextBar } from '@/statusline/render';

export interface SubagentTask {
  id: string;
  name?: string;
  description?: string;
  tokenCount?: number;
  contextWindowSize?: number;
}

export interface SubagentPayload {
  columns?: number;
  tasks?: SubagentTask[];
}

const BAR_WIDTH = 8;
const RESET = '\x1b[0m';
const WHITE = '\x1b[37m';

const formatTokens = (count: number): string => (count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`);

const usageSegment = (task: SubagentTask): string | undefined => {
  if (typeof task.tokenCount !== 'number') return undefined;
  if (typeof task.contextWindowSize === 'number' && task.contextWindowSize > 0) {
    const percent = Math.min(100, Math.floor((task.tokenCount * 100) / task.contextWindowSize));
    return `${contextBar(percent, BAR_WIDTH)} ${WHITE}${percent}%${RESET}`;
  }
  return `${WHITE}${formatTokens(task.tokenCount)} tok${RESET}`;
};

/** Visible width of a segment: ANSI colour codes take no columns. */
const visibleLength = (text: string): number => text.replace(/\x1b\[[0-9;]*m/g, '').length;

export const renderSubagentRow = (task: SubagentTask, columns?: number): string => {
  const usage = usageSegment(task);
  const tail = usage === undefined ? '' : ` · ${usage}`;
  const name = task.name ?? task.id;
  const room = columns === undefined ? Infinity : columns - visibleLength(`${name} · ${tail}`);
  const description = (task.description ?? '').trim();
  const shown =
    description.length <= room ? description : room < 2 ? '' : `${description.slice(0, room - 1).trimEnd()}…`;
  return shown ? `${name} · ${shown}${tail}` : `${name}${tail}`;
};

export const renderSubagentRows = (payload: SubagentPayload): string =>
  (payload.tasks ?? [])
    .map((task) => JSON.stringify({ id: task.id, content: renderSubagentRow(task, payload.columns) }))
    .join('\n');
