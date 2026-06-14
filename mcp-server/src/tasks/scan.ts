import { FOLDERS } from '@/config';
import { createLogger } from '@/shared/log';
import type { TaskFile } from '@/shared/types';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseTaskFile } from './schema';

const log = createLogger('tasks.scan');

// ── Project discovery ────────────────────────────────────────────────

/** List every project (directory under FOLDERS.PROJECTS that contains a `tasks/` folder). */
export const discoverProjects = (): string[] => {
  if (!existsSync(FOLDERS.PROJECTS)) return [];
  return readdirSync(FOLDERS.PROJECTS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(FOLDERS.PROJECTS, e.name, 'tasks')))
    .map((e) => e.name)
    .sort();
};

/**
 * Derive a project prefix from its slug as a fallback for projects with no
 * existing tasks yet.
 *   - Two-or-more hyphen-separated parts: first letter of each, capped at 2
 *     (`agent-layer` → `al`, `prophetic-day-routine` → `pd`)
 *   - Single word: first 2 letters (`homestead` → `ho`)
 */
const derivePrefix = (slug: string): string => {
  const parts = slug.toLowerCase().split('-').filter(Boolean);
  if (parts.length >= 2)
    return parts
      .slice(0, 2)
      .map((p) => p[0])
      .join('');
  return slug.slice(0, 2).toLowerCase();
};

/**
 * Look at existing task filenames (`<prefix>-<NNN>-<slug>.md`) and return
 * the most-used prefix, or null when the project has no tasks yet. Honors
 * legacy conventions where the derived rule would disagree (e.g. a project
 * directory named `homestead` may have always used `hd`, not `ho`).
 */
const inferPrefixFromTasks = (project: string): string | null => {
  const dir = join(FOLDERS.PROJECTS, project, 'tasks');
  if (!existsSync(dir)) return null;
  const counts = new Map<string, number>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md') || f.startsWith('.')) continue;
    const m = f.match(/^([a-z]+)-\d+/);
    if (!m) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

/** Resolve a project's task-id prefix. Prefers existing tasks; falls back to slug derivation. */
export const getProjectPrefix = (project: string): string => inferPrefixFromTasks(project) ?? derivePrefix(project);

/**
 * Build the prefix → project map by walking the filesystem. On collisions
 * (two projects yield the same prefix), the later one (alphabetical) gets a
 * numeric suffix: `hs` → `hs2`. Memoized per call; rebuild is cheap.
 */
export const buildPrefixMap = (): Map<string, string> => {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const project of discoverProjects()) {
    let prefix = getProjectPrefix(project);
    if (used.has(prefix)) {
      let n = 2;
      while (used.has(`${prefix}${n}`)) n++;
      prefix = `${prefix}${n}`;
    }
    used.add(prefix);
    map.set(prefix, project);
  }
  return map;
};

// ── Task scanning ────────────────────────────────────────────────────

/** Parse every task markdown file directly inside `dir` (non-recursive — the
 *  `archive/` subdir is skipped here because it isn't a `.md` file). */
const readTaskDir = (dir: string): TaskFile[] => {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    // Task files are `<prefix>-<NNN>...md`; skip README.md and other non-task
    // markdown (archive/ dirs carry a README) so they don't log parse warnings.
    .filter((f) => f.endsWith('.md') && !f.startsWith('.') && /^[a-z]+-\d+/.test(f))
    .flatMap<TaskFile>((file) => {
      const filePath = join(dir, file);
      const task = parseTaskFile(filePath);
      if (task) return [task];
      log.warn(`Failed to parse task file: ${filePath}`);
      return [];
    });
};

/** Scan a single project's tasks/ folder (active tasks; excludes archive/). */
const scanProject = (project: string): TaskFile[] => readTaskDir(join(FOLDERS.PROJECTS, project, 'tasks'));

/** Scan all discovered projects for active task files. */
export const scanAllTasks = (): TaskFile[] => discoverProjects().flatMap(scanProject);

/** Scan a single project's tasks/archive/ folder (closed: done/cancelled). */
const scanProjectArchive = (project: string): TaskFile[] =>
  readTaskDir(join(FOLDERS.PROJECTS, project, 'tasks', 'archive'));

/** Scan all discovered projects for archived (closed) task files. Dependency
 *  resolution needs these: a `done` dep is moved to tasks/archive/, and if it's
 *  absent from the status map its dependents read it as unresolved and get
 *  falsely auto-blocked. Not part of the active working set — status only. */
export const scanArchivedTasks = (): TaskFile[] => discoverProjects().flatMap(scanProjectArchive);

/** Get the next available task ID for a project. Scans both active and archive dirs. */
export const getNextId = (project: string): string => {
  const prefix = getProjectPrefix(project);
  const tasksDir = join(FOLDERS.PROJECTS, project, 'tasks');
  const idRe = new RegExp(`^${prefix}-(\\d+)`);
  let maxNum = 0;

  const scanDir = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const m = file.match(idRe);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  };

  scanDir(tasksDir);
  scanDir(join(tasksDir, 'archive'));

  const next = maxNum + 1;
  return `${prefix}-${next < 1000 ? String(next).padStart(3, '0') : String(next)}`;
};

/**
 * Find a task by its ID across all projects. Returns null if no project's
 * prefix matches or no file matches.
 *
 * Fast path: filenames are `<id>-<slug>.md` by convention (or bare `<id>.md`),
 * so we match by filename and parse only that one file.
 */
export const findTaskById = (id: string): TaskFile | null => {
  const dashIdx = id.indexOf('-');
  if (dashIdx === -1) return null;

  const project = buildPrefixMap().get(id.slice(0, dashIdx));
  if (!project) return null;

  const tasksDir = join(FOLDERS.PROJECTS, project, 'tasks');
  if (!existsSync(tasksDir)) return null;

  const match = readdirSync(tasksDir).find(
    (f) => (f.startsWith(`${id}-`) || f === `${id}.md`) && f.endsWith('.md') && !f.startsWith('.')
  );
  return match ? parseTaskFile(join(tasksDir, match)) : null;
};

/** Query tasks with optional filters. Sorted by priority, then due date, then created. */
export const queryTasks = (filters: {
  assignee?: string;
  status?: string;
  project?: string;
  priority?: string;
}): TaskFile[] => {
  const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

  return scanAllTasks()
    .filter((t) => !filters.assignee || t.frontmatter.assignee.includes(filters.assignee))
    .filter((t) => !filters.status || t.frontmatter.status === filters.status)
    .filter((t) => !filters.project || t.frontmatter.project === filters.project)
    .filter((t) => !filters.priority || t.frontmatter.priority === filters.priority)
    .sort((a, b) => {
      const pDiff = (priorityOrder[a.frontmatter.priority] ?? 9) - (priorityOrder[b.frontmatter.priority] ?? 9);
      if (pDiff !== 0) return pDiff;
      const aDue = a.frontmatter.due || '9999';
      const bDue = b.frontmatter.due || '9999';
      if (aDue !== bDue) return aDue.localeCompare(bDue);
      return a.frontmatter.created.localeCompare(b.frontmatter.created);
    });
};
