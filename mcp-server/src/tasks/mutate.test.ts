import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import { appendThread, closeTask, createTask, updateTask } from './mutate';
import { findTaskById } from './scan';

const newTask = (extra: { parent?: string; checklist?: string[] } = {}) => {
  mkdirSync(join(FOLDERS.PROJECTS, 'acme', 'tasks'), { recursive: true });
  return createTask({
    project: 'acme',
    title: 'Ship the invoice export',
    description: 'Customers asked for CSV.',
    assignee: ['user'],
    ...extra
  });
};

const from = (content: string, heading: string) => content.slice(content.indexOf(heading));

describe('parent, depends_on and checklist', () => {
  test('create stores parent and checklist, update changes parent and depends_on', () => {
    const epic = newTask();
    const created = newTask({ parent: epic.frontmatter.id, checklist: ['Write the query', 'Add the button'] });
    const id = created.frontmatter.id;

    expect(findTaskById(id)?.frontmatter.parent).toBe(epic.frontmatter.id);
    expect(findTaskById(id)?.checklist).toEqual([
      { checked: false, text: 'Write the query' },
      { checked: false, text: 'Add the button' }
    ]);

    updateTask(id, { parent: '', depends_on: [epic.frontmatter.id] });
    expect(findTaskById(id)?.frontmatter.parent).toBe('');
    expect(findTaskById(id)?.frontmatter.depends_on).toEqual([epic.frontmatter.id]);
  });
});

describe('issue', () => {
  const url = 'https://github.com/acme/widgets/issues/42';

  test('a hand-off link is written, read back and cleared', () => {
    const id = newTask().frontmatter.id;
    expect(findTaskById(id)?.frontmatter.issue).toBe('');

    updateTask(id, { issue: url });
    expect(findTaskById(id)?.frontmatter.issue).toBe(url);

    updateTask(id, { issue: '' });
    expect(findTaskById(id)?.frontmatter.issue).toBe('');
  });

  test('anything but a GitHub issue URL is refused before the write', () => {
    const created = newTask();
    const before = readFileSync(created.filePath, 'utf-8');

    expect(() => updateTask(created.frontmatter.id, { issue: 'https://github.com/acme/widgets/pull/42' })).toThrow(
      'Not a GitHub issue URL'
    );
    expect(() => updateTask(created.frontmatter.id, { issue: 'acme/widgets#42' })).toThrow('Not a GitHub issue URL');
    expect(readFileSync(created.filePath, 'utf-8')).toBe(before);
  });

  test('a task file written before the field existed reads as not handed off', () => {
    const created = newTask();
    writeFileSync(created.filePath, readFileSync(created.filePath, 'utf-8').replace(/^issue:.*\n/m, ''));
    expect(findTaskById(created.frontmatter.id)?.frontmatter.issue).toBe('');
  });
});

describe('closeTask', () => {
  test('a blocked task closes as done', () => {
    const id = newTask().frontmatter.id;
    updateTask(id, { status: 'blocked' });

    closeTask(id);
    expect(findTaskById(id)?.frontmatter.status).toBe('done');
  });
});

describe('updateTask description', () => {
  test('replaces only the description; checklist and thread stay byte-for-byte', () => {
    const created = newTask({ checklist: ['Write the query'] });
    const id = created.frontmatter.id;
    appendThread(id, 'user', 'Ada wants it by Friday.', 'quote');
    const before = readFileSync(created.filePath, 'utf-8');

    updateTask(id, { priority: 'P1', description: 'Export invoices as CSV.\n\n### Scope\nAll invoices since 2020.' });

    const after = readFileSync(created.filePath, 'utf-8');
    expect(findTaskById(id)?.description).toBe('Export invoices as CSV.\n\n### Scope\nAll invoices since 2020.');
    expect(findTaskById(id)?.frontmatter.priority).toBe('P1');
    expect(from(after, '## Checklist')).toBe(from(before, '## Checklist'));
  });

  test('adds a missing Description section before the checklist', () => {
    const created = newTask({ checklist: ['Write the query'] });
    const raw = readFileSync(created.filePath, 'utf-8');
    writeFileSync(created.filePath, raw.replace('## Description\n\nCustomers asked for CSV.\n\n', ''));

    updateTask(created.frontmatter.id, { description: 'Restored.' });

    const task = findTaskById(created.frontmatter.id);
    expect(task?.description).toBe('Restored.');
    expect(task?.checklist).toEqual([{ checked: false, text: 'Write the query' }]);
  });

  test('a duplicated Description heading edits the one the parser reads', () => {
    const created = newTask();
    const raw = readFileSync(created.filePath, 'utf-8');
    writeFileSync(created.filePath, raw.replace('## Checklist', '## Description\n\nSecond copy.\n\n## Checklist'));

    updateTask(created.frontmatter.id, { description: 'Rewritten.' });

    expect(findTaskById(created.frontmatter.id)?.description).toBe('Rewritten.');
  });

  test('a refused description writes nothing, not even the other fields', () => {
    const created = newTask();
    const before = readFileSync(created.filePath, 'utf-8');

    expect(() =>
      updateTask(created.frontmatter.id, { priority: 'P0', description: 'Intro\n## Checklist\n- [ ] sneaky' })
    ).toThrow('heading');
    expect(readFileSync(created.filePath, 'utf-8')).toBe(before);
  });
});
