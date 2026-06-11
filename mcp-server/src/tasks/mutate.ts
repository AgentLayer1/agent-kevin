import { FOLDERS, TIMEZONE } from '@/config';
import { createLogger } from '@/shared/log';
import {
  PostWriteDriftError,
  type CreateTaskOptions,
  type TaskFile,
  type TaskFrontmatter,
  type TaskStatus,
  type ThreadEntry
} from '@/shared/types';
import { todayDate } from '@/shared/date';
import { writeFileAtomic } from '@/shared/utils';
import { existsSync, readFileSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { withDashboardBatch, writeDashboardSafe } from './dashboard';
import { buildTaskMap, rewriteLinks } from './link';
import type { ScanResult } from './resolve';
import { findTaskById, getNextId } from './scan';
import { defaultFrontmatter, isValidTransition, parseFrontmatter, replaceFrontmatter, serializeTask } from './schema';

const log = createLogger('tasks.mutate');

const now = () => {
  // 'sv' locale gives ISO-like "YYYY-MM-DD HH:MM:SS"
  const [date, time] = new Date().toLocaleString('sv', { timeZone: TIMEZONE }).split(' ');
  return `${date} ${time.slice(0, 5)}`;
};

const isFieldEqual = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    // Set-equality — YAML re-emit can shuffle but never duplicate. `[a,b]` and
    // `[b,a,a]` must compare unequal (the prior `every+includes` was symmetric
    // only for unique inputs).
    if (a.length !== b.length) return false;
    const setA = new Set(a);
    return setA.size === a.length && b.every((v) => setA.has(v));
  }
  return a === b;
};

export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

/**
 * Surgical frontmatter update — reads raw file, parses only frontmatter,
 * applies field changes, replaces frontmatter block, keeps body byte-for-byte.
 * Returns the updated frontmatter for the caller.
 */
const updateFrontmatterOnDisk = (filePath: string, apply: (fm: TaskFrontmatter) => void): TaskFrontmatter => {
  const content = readFileSync(filePath, 'utf-8');
  const fm = parseFrontmatter(content);
  if (!fm) throw new Error(`Failed to parse frontmatter: ${filePath}`);

  apply(fm);
  fm.updated = todayDate();

  writeFileAtomic(filePath, replaceFrontmatter(content, fm));
  return fm;
};

/**
 * Append a thread entry to the end of a task file.
 * Only touches the frontmatter (updated date) and appends raw text.
 * Body content is never parsed or modified.
 */
const appendThreadToDisk = (filePath: string, type: ThreadEntry['type'], author: string, message: string): void => {
  let content = readFileSync(filePath, 'utf-8');
  const fm = parseFrontmatter(content);
  if (!fm) throw new Error(`Failed to parse frontmatter: ${filePath}`);

  fm.updated = todayDate();
  content = replaceFrontmatter(content, fm);

  // Format and append the callout block
  const lines = [`> [!${type}] ${author} · ${now()}`];
  for (const msgLine of message.split('\n')) {
    lines.push(`> ${msgLine}`);
  }
  content = content.trimEnd() + '\n\n' + lines.join('\n') + '\n';

  writeFileAtomic(filePath, content);
};

/**
 * Asserts that every requested field is reflected in the observed frontmatter.
 * Throws `PostWriteDriftError` on the first mismatch — write happened but the
 * value didn't land. Arrays compare as sets (order-independent) since YAML
 * re-emit can legitimately reshuffle them. Fields explicitly set to `undefined`
 * are skipped.
 */
export const verifyMutation = (
  taskId: string,
  filePath: string,
  requested: Partial<TaskFrontmatter>,
  observed: TaskFrontmatter
): void => {
  for (const [field, expected] of Object.entries(requested)) {
    if (expected === undefined) continue;
    const actual = observed[field as keyof TaskFrontmatter];
    if (!isFieldEqual(actual, expected)) {
      throw new PostWriteDriftError(taskId, field, expected, actual, filePath);
    }
  }
};

// ── Create ────────────────────────────────────────────────────────────
// New files are fully serialized — no round-trip risk.

export const createTask = (opts: CreateTaskOptions): TaskFile => {
  const projectDir = join(FOLDERS.PROJECTS, opts.project);
  if (!existsSync(projectDir))
    throw new Error(`Unknown project: ${opts.project} (directory not found under ${FOLDERS.PROJECTS})`);

  const id = getNextId(opts.project);
  const slug = slugify(opts.title);
  const fileName = `${id}-${slug}.md`;
  const filePath = join(FOLDERS.PROJECTS, opts.project, 'tasks', fileName);

  const fm: TaskFrontmatter = {
    ...defaultFrontmatter(opts.project, opts.title, opts.assignee ?? ['kevin']),
    id,
    ...(opts.priority && { priority: opts.priority }),
    ...(opts.type && { type: opts.type }),
    ...(opts.labels && { labels: opts.labels }),
    ...(opts.due && { due: opts.due }),
    ...(opts.depends_on && { depends_on: opts.depends_on }),
    ...(opts.blocked_by && { blocked_by: opts.blocked_by }),
    ...(opts.parent && { parent: opts.parent })
  };

  const task: TaskFile = {
    frontmatter: fm,
    description: opts.description ?? '',
    checklist: (opts.checklist ?? []).map((text) => ({ checked: false, text })),
    thread: [],
    filePath
  };

  writeFileAtomic(filePath, serializeTask(task));
  log.info(`Created task ${id}: ${opts.title} in ${opts.project}`);
  writeDashboardSafe();
  return task;
};

// ── Update ────────────────────────────────────────────────────────────
// Surgical: only frontmatter is modified, body is untouched.

export const updateTask = (id: string, fields: Partial<Omit<TaskFrontmatter, 'id' | 'schema' | 'created'>>): void => {
  const task = findTaskById(id);
  if (!task) throw new Error(`Task not found: ${id}`);

  // Validate status transitions
  if (fields.status && fields.status !== task.frontmatter.status) {
    if (!isValidTransition(task.frontmatter.status, fields.status as TaskStatus)) {
      throw new Error(`Invalid status transition: ${task.frontmatter.status} -> ${fields.status}`);
    }
  }

  updateFrontmatterOnDisk(task.filePath, (fm) => {
    Object.assign(fm, fields);
    if (fields.status === 'done' || fields.status === 'cancelled') {
      fm.closed = todayDate();
    }
  });

  // Round-trip: re-read fresh from disk and assert every requested field
  // actually persisted. The frontmatter returned by updateFrontmatterOnDisk
  // is the in-memory value; only a fresh read catches serialization drift,
  // partial writes, or sandbox rejection.
  const verifyContent = readFileSync(task.filePath, 'utf-8');
  const observed = parseFrontmatter(verifyContent);
  if (!observed) {
    throw new Error(`Failed to re-read frontmatter after write: ${task.filePath}`);
  }
  verifyMutation(id, task.filePath, fields, observed);

  log.info(`Updated task ${id}: ${JSON.stringify(fields)}`);
  writeDashboardSafe();
};

// ── Close ─────────────────────────────────────────────────────────────
// Schema disallows open -> done directly (the active step encodes "work
// happened"). For a fresh task being closed in one shot, walk through active
// so the invariant holds without forcing every caller to do it manually.

export const closeTask = (id: string): void => {
  const task = findTaskById(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  if (task.frontmatter.status === 'open') {
    updateTask(id, { status: 'active' });
  }
  updateTask(id, { status: 'done' });
};

// ── Append Thread ─────────────────────────────────────────────────────
// Surgical: appends raw text to end of file. Body is never parsed.

export const appendThread = (id: string, author: string, message: string, type: ThreadEntry['type'] = 'info'): void => {
  const task = findTaskById(id);
  if (!task) throw new Error(`Task not found: ${id}`);

  // Auto-link bare task IDs in the message body so cross-task references render
  // as clickable wikilinks in Obsidian. The CLI keeps bare IDs as canonical
  // input; rewriting happens at write-time only.
  const linkedMessage = rewriteLinks(message, buildTaskMap());
  appendThreadToDisk(task.filePath, type, author, linkedMessage);
  writeDashboardSafe();
};

// ── Assign Pending IDs ────────────────────────────────────────────────
// Rename the file, then surgical frontmatter update. Body preserved byte-for-byte
// (including any unknown keys or content outside our known section headers).

export const assignPendingIds = (tasks: TaskFile[]): string[] => {
  const assigned: string[] = [];

  for (const task of tasks) {
    if (task.frontmatter.id !== 'auto' && task.frontmatter.id !== '') continue;

    const project = task.frontmatter.project;
    if (!project || !existsSync(join(FOLDERS.PROJECTS, project))) {
      log.warn(`Cannot assign ID: unknown project in ${task.filePath}`);
      continue;
    }

    const newId = getNextId(project);
    const slug = slugify(task.frontmatter.title);
    const newFileName = `${newId}-${slug}.md`;
    const newPath = join(dirname(task.filePath), newFileName);

    try {
      if (task.filePath !== newPath) {
        renameSync(task.filePath, newPath);
      }
      updateFrontmatterOnDisk(newPath, (fm) => {
        fm.id = newId;
      });
    } catch (err) {
      log.error(`Failed to assign ID for ${task.filePath}`, err);
      continue;
    }

    assigned.push(newId);
    log.info(`Assigned ID ${newId} to task: ${task.frontmatter.title}`);
  }

  if (assigned.length > 0) writeDashboardSafe();
  return assigned;
};

// ── Apply Resolution Results ──────────────────────────────────────────
// Each bucket in the ScanResult represents one auto-action the scanner detected.
// For each, mutate the task and append an audit-trail thread entry in one step.

interface ApplyRule {
  tasks: TaskFile[];
  /** Stage name — used for logging and in the returned map. */
  stage: 'unblocked' | 'blocked' | 'closed' | 'manualClosed' | 'clearedBlocker';
  /** Frontmatter change to apply (or null if the mutation is closeTask). */
  update: ((task: TaskFile) => Partial<TaskFrontmatter>) | 'close';
  /** Thread message template — receives the task so it can interpolate context. */
  message: (task: TaskFile) => string;
}

const applyBucket = (rule: ApplyRule): string[] => {
  const ids: string[] = [];
  for (const task of rule.tasks) {
    try {
      if (rule.update === 'close') {
        closeTask(task.frontmatter.id);
      } else {
        updateTask(task.frontmatter.id, rule.update(task));
      }
      appendThread(task.frontmatter.id, 'kevin', rule.message(task), 'warning');
      ids.push(task.frontmatter.id);
    } catch (err) {
      log.error(`Failed to apply ${rule.stage} to ${task.frontmatter.id}`, err);
    }
  }
  return ids;
};

export const applyResolution = (
  result: ScanResult
): {
  unblockedIds: string[];
  blockedIds: string[];
  closedIds: string[];
  manualClosedIds: string[];
  clearedBlockerIds: string[];
  assignedIds: string[];
} =>
  // Defer dashboard rebuilds — each bucket mutation otherwise triggers a full
  // task-tree rescan + TASKS.md write. With N tasks across 5 buckets that's
  // 5N+ rebuilds; batching collapses to one.
  withDashboardBatch(() => {
    const unblockedIds = applyBucket({
      tasks: result.unblocked,
      stage: 'unblocked',
      update: () => ({ status: 'active' }),
      message: () => 'Auto: All dependencies resolved. Status -> active.'
    });

    const blockedIds = applyBucket({
      tasks: result.autoBlocked,
      stage: 'blocked',
      update: () => ({ status: 'blocked' }),
      message: (t) => {
        const reason = t.frontmatter.blocked_by
          ? `External blocker: ${t.frontmatter.blocked_by}`
          : `Unresolved dependencies: ${t.frontmatter.depends_on.join(', ')}`;
        return `Auto: ${reason}. Status -> blocked.`;
      }
    });

    const closedIds = applyBucket({
      tasks: result.autoClosed,
      stage: 'closed',
      update: 'close',
      message: () => 'Auto: All checklist items complete. Closing.'
    });

    const manualClosedIds = applyBucket({
      tasks: result.manualClosed,
      stage: 'manualClosed',
      update: () => ({ closed: todayDate() }),
      message: () => 'Auto: Closed date set. Status was changed manually in Obsidian.'
    });

    const clearedBlockerIds = applyBucket({
      tasks: result.clearedBlockers,
      stage: 'clearedBlocker',
      update: () => ({ blocked_by: '' }),
      message: (t) =>
        `Auto: Status manually set to active but blocked_by was still set ("${t.frontmatter.blocked_by}"). Clearing blocked_by.`
    });

    const assignedIds = assignPendingIds(result.pendingIds);

    return { unblockedIds, blockedIds, closedIds, manualClosedIds, clearedBlockerIds, assignedIds };
  });
