/**
 * Task MCP tools — read + mutate the Projects/<project>/tasks/<id>.md files.
 */
import type { TaskFile, TaskPriority, TaskType, ThreadEntry } from '@/shared/types';
import { defineTool, type ToolDef } from '@/shared/types';
import { HORIZON_BUCKETS, horizonBucket } from '@/tasks/horizon';
import { appendThread, closeTask, createTask, updateTask } from '@/tasks/mutate';
import { resolveTasks } from '@/tasks/resolve';
import { findTaskById, queryTasks, scanAllTasks, scanArchivedTasks } from '@/tasks/scan';
import { z } from 'zod';

const StatusEnum = z.enum(['open', 'active', 'blocked', 'done', 'cancelled']);
const PriorityEnum = z.enum(['P0', 'P1', 'P2', 'P3']);
const TypeEnum = z.enum(['task', 'bug', 'idea', 'epic']);
const ThreadKindEnum = z.enum(['quote', 'info', 'warning']);
const HorizonInput = z
  .string()
  .describe('today, week, next-week, month, later, or a period (2026-09-28, 2026-W40, 2026-10); stored as the period. Empty clears.');

const slim = (t: TaskFile) => ({
  id: t.frontmatter.id,
  title: t.frontmatter.title,
  status: t.frontmatter.status,
  priority: t.frontmatter.priority,
  type: t.frontmatter.type,
  project: t.frontmatter.project,
  assignee: t.frontmatter.assignee,
  due: t.frontmatter.due,
  horizon: t.frontmatter.horizon,
  depends_on: t.frontmatter.depends_on,
  blocked_by: t.frontmatter.blocked_by,
  updated: t.frontmatter.updated,
  filePath: t.filePath
});

export const tools: ToolDef[] = [
  defineTool({
    name: 'task_query',
    description: 'List tasks across all projects, optionally filtered by status/priority/project/assignee/horizon lane.',
    inputSchema: {
      status: StatusEnum.optional(),
      priority: PriorityEnum.optional(),
      project: z.string().optional(),
      assignee: z.string().optional(),
      horizon: z
        .enum(HORIZON_BUCKETS)
        .optional()
        .describe('Lane as of today: carried (a past period), today, week, month, later'),
      includeClosed: z.boolean().optional().describe('Include done/cancelled (default false)')
    },
    handler: async ({ status, priority, project, assignee, horizon, includeClosed }) => {
      const filters: Record<string, string> = {};
      if (status) filters.status = status;
      if (priority) filters.priority = priority;
      if (project) filters.project = project;
      if (assignee) filters.assignee = assignee;
      const tasks = queryTasks(filters);
      const filtered = tasks
        .filter((t) => includeClosed || (t.frontmatter.status !== 'done' && t.frontmatter.status !== 'cancelled'))
        .filter((t) => !horizon || horizonBucket(t.frontmatter.horizon) === horizon);
      return { count: filtered.length, tasks: filtered.map(slim) };
    }
  }),
  defineTool({
    name: 'task_get',
    description: 'Read a single task file in full (frontmatter + description + checklist + thread).',
    inputSchema: { id: z.string() },
    handler: async ({ id }) => {
      const task = findTaskById(id);
      if (!task) throw new Error(`Task not found: ${id}`);
      return {
        ...task.frontmatter,
        description: task.description,
        checklist: task.checklist,
        thread: task.thread,
        filePath: task.filePath
      };
    }
  }),
  defineTool({
    name: 'task_create',
    description: 'Create a new task. Description is required — pass real context, not a stub.',
    inputSchema: {
      project: z.string(),
      title: z.string(),
      description: z.string(),
      assignee: z.array(z.string()).optional(),
      priority: PriorityEnum.optional(),
      type: TypeEnum.optional(),
      labels: z.array(z.string()).optional(),
      due: z.string().optional().describe('YYYY-MM-DD'),
      horizon: HorizonInput.optional(),
      depends_on: z.array(z.string()).optional()
    },
    handler: async (args) =>
      createTask({
        project: args.project,
        title: args.title,
        description: args.description,
        assignee: args.assignee ?? ['user'],
        priority: (args.priority ?? 'P2') as TaskPriority,
        type: (args.type ?? 'task') as TaskType,
        labels: args.labels ?? [],
        due: args.due ?? '',
        horizon: args.horizon ?? '',
        depends_on: args.depends_on ?? []
      })
  }),
  defineTool({
    name: 'task_update',
    description: 'Update fields on an existing task. Status transitions are validated.',
    inputSchema: {
      id: z.string(),
      status: StatusEnum.optional(),
      priority: PriorityEnum.optional(),
      title: z.string().optional(),
      assignee: z.array(z.string()).optional(),
      due: z.string().optional(),
      horizon: HorizonInput.optional(),
      blocked_by: z.string().optional(),
      labels: z.array(z.string()).optional()
    },
    handler: async ({ id, ...fields }) => {
      const updates = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      updateTask(id, updates);
      return { ok: true };
    }
  }),
  defineTool({
    name: 'task_close',
    description: 'Close a task as done (status=done, closed=today).',
    inputSchema: { id: z.string() },
    handler: async ({ id }) => {
      closeTask(id);
      return { ok: true };
    }
  }),
  defineTool({
    name: 'task_thread',
    description: "Append a message to a task's thread section.",
    inputSchema: {
      id: z.string(),
      author: z.string(),
      message: z.string(),
      type: ThreadKindEnum.optional().describe('Callout type — defaults to info')
    },
    handler: async ({ id, author, message, type }) => {
      appendThread(id, author, message, (type ?? 'info') as ThreadEntry['type']);
      return { ok: true };
    }
  }),
  defineTool({
    name: 'task_scan',
    description:
      'Resolve cross-task state: auto-unblock, auto-block, surface overdue, due-soon (next 14 days) and stale tasks, plan priority bumps.',
    inputSchema: {},
    handler: async () => {
      const all = scanAllTasks();
      const result = resolveTasks(all, scanArchivedTasks());
      return {
        scanned: all.length,
        unblocked: result.unblocked.map(slim),
        autoBlocked: result.autoBlocked.map(slim),
        autoClosed: result.autoClosed.map(slim),
        manualClosed: result.manualClosed.map(slim),
        clearedBlockers: result.clearedBlockers.map(slim),
        overdue: result.overdue.map(slim),
        dueSoon: result.dueSoon.map(slim),
        stale: result.stale.map(slim),
        priorityBumps: result.priorityBumps.map(({ blocker, blocked }) => ({
          blocker: slim(blocker),
          blocked: slim(blocked)
        })),
        pendingIds: result.pendingIds.map(slim)
      };
    }
  })
];
