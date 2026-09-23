import { describe, expect, test } from 'bun:test';
import type { TaskFile, TaskFrontmatter } from '@/shared/types';
import { formatDashboard } from './dashboard';

const task = (id: string, project: string, updated: string): TaskFile => {
  const frontmatter: TaskFrontmatter = {
    schema: 1,
    id,
    title: `Title of ${id}`,
    type: 'task',
    status: 'open',
    priority: 'P2',
    project,
    assignee: [],
    labels: [],
    created: '2026-01-01',
    updated,
    due: '',
    depends_on: [],
    blocked_by: '',
    parent: '',
    closed: ''
  };
  return { frontmatter, description: '', checklist: [], thread: [], filePath: `/tasks/${id}-slug.md` };
};

const staleSection = (stale: TaskFile[]): string => {
  const markdown = formatDashboard({ active: stale, blocked: [], overdue: [], stale, closedRecent: [] }, '');
  return markdown.slice(markdown.indexOf('## Stale'), markdown.indexOf('## Recently Closed')).trim();
};

describe('formatDashboard Stale section', () => {
  test('lists ids per project, oldest update first, without repeating titles', () => {
    const section = staleSection([
      task('lo-002', 'life-os', '2026-07-24'),
      task('al-017', 'agent-layer', '2026-06-29'),
      task('lo-001', 'life-os', '2026-05-03')
    ]);
    expect(section).toBe(
      '## Stale (3)\n\n- **agent-layer**: al-017 (06-29)\n- **life-os**: lo-001 (05-03) · lo-002 (07-24)'
    );
  });

  test('an empty section says none', () => {
    expect(staleSection([])).toBe('## Stale (0)\n\n_(none)_');
  });
});
