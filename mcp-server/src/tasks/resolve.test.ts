import { describe, expect, test } from 'bun:test';
import { daysAgoDate } from '@/shared/date';
import type { TaskFile, TaskFrontmatter, TaskStatus } from '@/shared/types';
import { DUE_SOON_DAYS, resolveTasks } from './resolve';

const task = (id: string, due: string, status: TaskStatus = 'open'): TaskFile => {
  const frontmatter: TaskFrontmatter = {
    schema: 1,
    id,
    title: `Title of ${id}`,
    type: 'task',
    status,
    priority: 'P2',
    project: 'acme',
    assignee: [],
    labels: [],
    created: '2026-01-01',
    updated: daysAgoDate(0),
    due,
    depends_on: [],
    blocked_by: '',
    parent: '',
    closed: status === 'done' ? daysAgoDate(0) : ''
  };
  return { frontmatter, description: '', checklist: [], thread: [], filePath: `/tasks/${id}-slug.md` };
};

const ids = (tasks: TaskFile[]): string[] => tasks.map((item) => item.frontmatter.id);

describe('resolveTasks dueSoon', () => {
  test('holds open work due from today through the window, and nothing past it', () => {
    const result = resolveTasks([
      task('ac-001', daysAgoDate(0)),
      task('ac-002', daysAgoDate(-3)),
      task('ac-003', daysAgoDate(-DUE_SOON_DAYS)),
      task('ac-004', daysAgoDate(-(DUE_SOON_DAYS + 6))),
      task('ac-005', '')
    ]);
    expect(ids(result.dueSoon)).toEqual(['ac-001', 'ac-002', 'ac-003']);
  });

  test('leaves overdue work to the overdue bucket', () => {
    const result = resolveTasks([task('ac-001', daysAgoDate(1))]);
    expect(ids(result.dueSoon)).toEqual([]);
    expect(ids(result.overdue)).toEqual(['ac-001']);
  });

  test('skips finished work but keeps blocked work', () => {
    const result = resolveTasks([
      task('ac-001', daysAgoDate(-2), 'done'),
      task('ac-002', daysAgoDate(-2), 'cancelled'),
      task('ac-003', daysAgoDate(-2), 'blocked')
    ]);
    expect(ids(result.dueSoon)).toEqual(['ac-003']);
  });
});
