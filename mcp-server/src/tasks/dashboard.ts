/**
 * Dashboard generator for `projects/TASKS.md`.
 *
 * Queries (`buildSections`) and formatter (`formatDashboard`) are kept
 * separate so each can be tested/replaced independently. `writeDashboard`
 * composes them and persists the file, preserving the human-authored
 * goals block between sentinel markers.
 */
import { FOLDERS } from '@/config';
import type { TaskFile, TaskFrontmatter } from '@/shared/types';
import { daysAgoDate, todayDate } from '@/shared/date';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { discoverProjects } from './scan';
import { parseTaskFile } from './schema';

/** Read every task file under every discovered project. Skips `tasks/archive/`. */
export const scanProjectTasks = (): TaskFile[] =>
  discoverProjects().flatMap((project) => {
    const dir = join(FOLDERS.PROJECTS, project, 'tasks');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .map((f) => parseTaskFile(join(dir, f)))
      .filter((t): t is TaskFile => t !== null);
  });

// ── Section building ──────────────────────────────────────────────────

export interface DashboardSections {
  active: TaskFile[];
  blocked: TaskFile[];
  overdue: TaskFile[];
  stale: TaskFile[];
  closedRecent: TaskFile[];
}

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

const isOpenStatus = (s: string): boolean => s !== 'done' && s !== 'cancelled';

const priorityRank = (p: string): number => PRIORITY_ORDER[p] ?? 9;

const byPriorityThenProject = (a: TaskFile, b: TaskFile): number => {
  const pd = priorityRank(a.frontmatter.priority) - priorityRank(b.frontmatter.priority);
  return pd !== 0 ? pd : a.frontmatter.project.localeCompare(b.frontmatter.project);
};

/** Compute all dashboard sections from a flat task list. Pure — no I/O. */
export const buildSections = (tasks: TaskFile[]): DashboardSections => {
  const today = todayDate();
  const sevenDaysAgo = daysAgoDate(7);
  const fourteenDaysAgo = daysAgoDate(14);

  const active = tasks
    .filter((t) => t.frontmatter.status === 'active' || t.frontmatter.status === 'open')
    .sort(byPriorityThenProject);

  const blocked = tasks.filter((t) => t.frontmatter.status === 'blocked').sort(byPriorityThenProject);

  const overdue = tasks
    .filter((t) => isOpenStatus(t.frontmatter.status) && t.frontmatter.due && t.frontmatter.due < today)
    .sort((a, b) => a.frontmatter.due.localeCompare(b.frontmatter.due));

  const stale = tasks
    .filter((t) => isOpenStatus(t.frontmatter.status) && t.frontmatter.updated && t.frontmatter.updated < sevenDaysAgo)
    .sort((a, b) => a.frontmatter.updated.localeCompare(b.frontmatter.updated));

  const closedRecent = tasks
    .filter(
      (t) =>
        (t.frontmatter.status === 'done' || t.frontmatter.status === 'cancelled') &&
        t.frontmatter.closed &&
        t.frontmatter.closed >= fourteenDaysAgo
    )
    .sort((a, b) => b.frontmatter.closed.localeCompare(a.frontmatter.closed))
    .slice(0, 20);

  return { active, blocked, overdue, stale, closedRecent };
};

// ── Formatting ────────────────────────────────────────────────────────

const fileSlug = (filePath: string, fallback: string): string =>
  filePath.split('/').pop()?.replace(/\.md$/, '') ?? fallback;

const taskLink = (t: TaskFile): string => `[[${fileSlug(t.filePath, t.frontmatter.id)}|${t.frontmatter.id}]]`;

type MetaField = keyof Pick<
  TaskFrontmatter,
  'project' | 'priority' | 'status' | 'due' | 'updated' | 'closed' | 'blocked_by' | 'depends_on' | 'assignee'
>;

const fmtMeta = (t: TaskFile, fields: MetaField[]): string => {
  const parts = fields.flatMap((f) => {
    const v = t.frontmatter[f];
    const empty = Array.isArray(v) ? v.length === 0 : !v;
    return empty ? [] : [`${f}: ${Array.isArray(v) ? v.join(', ') : v}`];
  });
  return parts.length === 0 ? '' : ` _(${parts.join(' · ')})_`;
};

const taskLine = (t: TaskFile, fields: MetaField[]): string =>
  `- ${taskLink(t)} **${t.frontmatter.title}**${fmtMeta(t, fields)}`;

const groupByProject = (tasks: TaskFile[]): [string, TaskFile[]][] => {
  const map = new Map<string, TaskFile[]>();
  for (const t of tasks) {
    const list = map.get(t.frontmatter.project) ?? [];
    list.push(t);
    map.set(t.frontmatter.project, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
};

const sectionBody = (lines: string[]): string => (lines.length === 0 ? '_(none)_' : lines.join('\n'));

const renderActive = (tasks: TaskFile[]): string => {
  if (tasks.length === 0) return '_(none)_';
  return groupByProject(tasks)
    .map(([project, list]) => {
      const lines = list.map((t) => taskLine(t, ['priority', 'status', 'due']));
      return `### ${project}\n${lines.join('\n')}`;
    })
    .join('\n\n');
};

/** Pure formatter — assemble final markdown from sections + goals block. */
export const formatDashboard = (sections: DashboardSections, goalsBlock: string): string => {
  const header = `> Tasks hub — auto-rebuilt by Kevin from task frontmatter on every mutation. Edit goals block only.\n> Last updated: ${todayDate()}\n`;

  const blockedBody = sectionBody(
    sections.blocked.map((t) => taskLine(t, ['project', 'priority', 'blocked_by', 'depends_on']))
  );
  const overdueBody = sectionBody(sections.overdue.map((t) => taskLine(t, ['project', 'priority', 'due', 'status'])));
  const staleBody = sectionBody(sections.stale.map((t) => taskLine(t, ['project', 'priority', 'updated', 'status'])));
  const closedBody = sectionBody(sections.closedRecent.map((t) => taskLine(t, ['project', 'status', 'closed'])));

  return [
    header,
    goalsBlock.trim(),
    `## Active (${sections.active.length})\n\n${renderActive(sections.active)}\n`,
    `## Blocked (${sections.blocked.length})\n\n${blockedBody}\n`,
    `## Overdue (${sections.overdue.length})\n\n${overdueBody}\n`,
    `## Stale (${sections.stale.length})\n\n${staleBody}\n`,
    `## Recently Closed (${sections.closedRecent.length})\n\n${closedBody}\n`
  ].join('\n');
};

// ── Goals-block preservation ──────────────────────────────────────────
// The goals block is human-authored (or written by weekly-goals/monthly-goals
// skills). The dashboard never touches it — extract from existing file,
// re-emit verbatim. Empty default is written on first run.

const GOALS_MARKER_START = '<!-- GOALS:START -->';
const GOALS_MARKER_END = '<!-- GOALS:END -->';

const EMPTY_GOALS_BLOCK = `${GOALS_MARKER_START}
## Monthly Goals

_No goals set yet — Kevin proposes on the 1st of each Hijri month._

## Weekly Goals

_No weekly goals set yet._
${GOALS_MARKER_END}`;

const extractGoalsBlock = (existing: string): string => {
  const start = existing.indexOf(GOALS_MARKER_START);
  const end = existing.indexOf(GOALS_MARKER_END);
  if (start === -1 || end === -1 || end < start) return EMPTY_GOALS_BLOCK;
  return existing.slice(start, end + GOALS_MARKER_END.length);
};

// ── Write ────────────────────────────────────────────────────────────

export interface DashboardCounts {
  active: number;
  blocked: number;
  overdue: number;
  stale: number;
  closedRecent: number;
}

const sectionCounts = (sections: DashboardSections): DashboardCounts => ({
  active: sections.active.length,
  blocked: sections.blocked.length,
  overdue: sections.overdue.length,
  stale: sections.stale.length,
  closedRecent: sections.closedRecent.length
});

/** Rebuild and write projects/TASKS.md. Preserves the goals block. */
export const writeDashboard = (): DashboardCounts => {
  const tasksFile = join(FOLDERS.PROJECTS, 'TASKS.md');
  let existing = '';
  try {
    existing = readFileSync(tasksFile, 'utf-8');
  } catch {
    // first run — no existing file, use empty goals scaffold
  }
  const goalsBlock = extractGoalsBlock(existing);

  const sections = buildSections(scanProjectTasks());
  writeFileSync(tasksFile, formatDashboard(sections, goalsBlock));

  return sectionCounts(sections);
};

/**
 * Best-effort dashboard rebuild for call sites that shouldn't fail when the
 * dashboard write hiccups (sandbox denial, transient FS error). Logs but
 * never throws — the calling mutation is the source of truth, the dashboard
 * is a derived view.
 *
 * When called from inside `withDashboardBatch(...)`, defers the actual write
 * until the outer scope exits — so a multi-mutation flow like `applyResolution`
 * does one rebuild instead of one per mutation (5-10x reduction).
 */
let batchDepth = 0;
let pendingWrite = false;

export const writeDashboardSafe = (): DashboardCounts | null => {
  if (batchDepth > 0) {
    pendingWrite = true;
    return null;
  }
  try {
    return writeDashboard();
  } catch {
    return null;
  }
};

/** Defer dashboard rebuilds inside `fn`; flush a single write after it returns. */
export const withDashboardBatch = <T>(fn: () => T): T => {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && pendingWrite) {
      pendingWrite = false;
      try {
        writeDashboard();
      } catch {
        // best-effort — caller has already succeeded
      }
    }
  }
};
