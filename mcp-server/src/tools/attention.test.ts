import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { FILES, FOLDERS } from '@/config';
import { createTask } from '@/tasks/mutate';
import { AttentionDataSchema, readAttentionData } from '@/status/attention-data';
import { tools } from './attention';

const attentionWrite = tools.find((tool) => tool.name === 'attention_write');

const call = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  if (!attentionWrite) {
    throw new Error('attention_write is not registered');
  }
  const parsed = z.object(attentionWrite.inputSchema).parse(args);
  const result = await attentionWrite.handler(parsed);
  return z.record(z.string(), z.unknown()).parse(result);
};

const prs = (url: string) => [{ label: 'My pull requests', empty: 'None open.', items: [{ title: '#7 Key rotation', url }] }];

describe('attention_write', () => {
  test('writes a project page, keeps its queue across re-renders, and links it from the project card', async () => {
    mkdirSync(join(FOLDERS.PROJECTS, 'ops', 'tasks'), { recursive: true });
    const planned = createTask({
      project: 'ops',
      title: 'Rotate the storage keys',
      description: 'Per-environment keys.',
      assignee: ['user'],
      priority: 'P1',
      horizon: 'today'
    });
    const page = join(FOLDERS.PROJECTS, 'ops', 'attention.html');

    const result = await call({ project: 'ops', queue: prs('https://github.com/acme/app/pull/7') });
    expect(result.path).toBe(page);
    const first = AttentionDataSchema.parse(result);
    expect(first.lanes.today.map(({ id, title, path }) => ({ id, title, path }))).toEqual([
      { id: planned.frontmatter.id, title: 'Rotate the storage keys', path: relative(FOLDERS.HOME, planned.filePath) }
    ]);
    expect(first.snapshot?.groups.map((group) => [group.label, group.items.length])).toEqual([['My pull requests', 1]]);
    const html = readFileSync(page, 'utf-8');
    expect(html).toContain('Rotate the storage keys');
    expect(readAttentionData(html)).toEqual(first);
    expect(existsSync(join(FOLDERS.HOME, 'attention.html'))).toBe(false);

    const second = AttentionDataSchema.parse(await call({ project: 'ops' }));
    expect(second.snapshot?.fetchedAt).toBe(first.snapshot?.fetchedAt);
    const dashboard = readFileSync(FILES.DASHBOARD, 'utf-8');
    expect(dashboard).toMatch(new RegExp(`${encodeURIComponent(page)}[^"]*">Attention</a>`));
    expect(dashboard).not.toContain('data-href="projects/ops/attention.html"');

    const home = await call({});
    expect(home.path).toBe(FILES.DASHBOARD);
    expect(AttentionDataSchema.parse(home)).toMatchObject({ project: '', snapshot: null });
    expect(readAttentionData(readFileSync(FILES.DASHBOARD, 'utf-8'))).toMatchObject({ project: '' });
    expect(existsSync(join(FOLDERS.HOME, 'attention.html'))).toBe(false);

    rmSync(page, { force: true });
    rmSync(FOLDERS.ATTENTION_QUEUES, { recursive: true, force: true });
  });

  test('a queue link that is not http(s) is refused', async () => {
    await expect(call({ queue: prs('javascript:alert(1)') })).rejects.toThrow('Queue links must be http(s)');
  });

  test('an unknown project is refused rather than creating a folder', async () => {
    await expect(call({ project: 'nope' })).rejects.toThrow('Unknown project: nope');
    expect(existsSync(join(FOLDERS.PROJECTS, 'nope'))).toBe(false);
  });
});
