import type { TaskFile } from '@/shared/types';
import { daysAgoDate, todayDate } from '@/shared/date';
import { isValidTransition } from './schema';

export interface ScanResult {
  total: number;
  unblocked: TaskFile[];
  autoBlocked: TaskFile[];
  autoClosed: TaskFile[];
  manualClosed: TaskFile[];
  clearedBlockers: TaskFile[];
  overdue: TaskFile[];
  stale: TaskFile[];
  priorityBumps: Array<{ blocker: TaskFile; blocked: TaskFile }>;
  pendingIds: TaskFile[];
}

/** Build a lookup map of task ID -> status. */
const buildStatusMap = (tasks: TaskFile[]): Map<string, string> =>
  new Map(tasks.map((t) => [t.frontmatter.id, t.frontmatter.status]));

/** Check if all checklist items are checked. */
const allChecked = (task: TaskFile): boolean =>
  task.checklist.length > 0 && task.checklist.every((item) => item.checked);

/** Check if a task is overdue. */
const isOverdue = (task: TaskFile): boolean => {
  if (!task.frontmatter.due) return false;
  if (task.frontmatter.status === 'done' || task.frontmatter.status === 'cancelled') return false;
  return task.frontmatter.due < todayDate();
};

/** Check if a task is stale (no update in 7+ days). */
const isStale = (task: TaskFile): boolean => {
  if (task.frontmatter.status !== 'active') return false;
  if (!task.frontmatter.updated) return false;
  return task.frontmatter.updated < daysAgoDate(7);
};

/**
 * Resolve dependencies and compute auto-status changes.
 * Returns a ScanResult describing what changed — does NOT write files.
 * The caller (mutate.ts operations or CLI) is responsible for persisting.
 */
export const resolveTasks = (tasks: TaskFile[]): ScanResult => {
  const statusMap = buildStatusMap(tasks);
  const result: ScanResult = {
    total: tasks.length,
    unblocked: [],
    autoBlocked: [],
    autoClosed: [],
    manualClosed: [],
    clearedBlockers: [],
    overdue: [],
    stale: [],
    priorityBumps: [],
    pendingIds: []
  };

  for (const task of tasks) {
    const fm = task.frontmatter;

    // Pending ID assignment (Obsidian-created with id: auto)
    if (fm.id === 'auto' || fm.id === '') {
      result.pendingIds.push(task);
      continue;
    }

    // Manual close: done/cancelled in Obsidian without closed date set
    if ((fm.status === 'done' || fm.status === 'cancelled') && !fm.closed) {
      result.manualClosed.push(task);
    }

    // Auto-unblock: blocked task whose deps are all done and no external blocker
    if (fm.status === 'blocked') {
      const depsResolved = fm.depends_on.length === 0 || fm.depends_on.every((dep) => statusMap.get(dep) === 'done');
      const externalClear = !fm.blocked_by;

      if (depsResolved && externalClear && isValidTransition('blocked', 'active')) {
        result.unblocked.push(task);
      }
    }

    // Auto-block: open/active task with unresolved deps.
    // `open` is included so `depends_on` is enforced before the task is ever picked up.
    // If only blocked_by is set (no dep issues) on an active task, user manually
    // unblocked — clear it instead.
    if (fm.status === 'active' || fm.status === 'open') {
      const hasUnresolvedDeps = fm.depends_on.length > 0 && fm.depends_on.some((dep) => statusMap.get(dep) !== 'done');
      const hasExternalBlocker = !!fm.blocked_by;

      if (hasUnresolvedDeps && isValidTransition(fm.status, 'blocked')) {
        result.autoBlocked.push(task);
      } else if (fm.status === 'active' && hasExternalBlocker) {
        result.clearedBlockers.push(task);
      }
    }

    // Auto-close: active task with all checklist items checked
    // Skip if task is also being auto-blocked (blocked -> done is invalid)
    if (fm.status === 'active' && allChecked(task) && !result.autoBlocked.includes(task)) {
      result.autoClosed.push(task);
    }

    // Overdue check
    if (isOverdue(task)) {
      result.overdue.push(task);
    }

    // Stale check
    if (isStale(task)) {
      result.stale.push(task);
    }

    // Priority bump suggestions: if a high-priority task depends on a lower-priority one
    if (fm.priority <= 'P1' && fm.depends_on.length > 0) {
      for (const depId of fm.depends_on) {
        const depTask = tasks.find((t) => t.frontmatter.id === depId);
        if (depTask && depTask.frontmatter.priority > fm.priority) {
          result.priorityBumps.push({ blocker: depTask, blocked: task });
        }
      }
    }
  }

  return result;
};
