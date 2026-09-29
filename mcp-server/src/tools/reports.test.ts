import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import { z } from 'zod';
import { tools } from './reports';

const extra = tools.find((tool) => tool.name === 'report_write')?.inputSchema.extra;
const accepts = (value: unknown): boolean => extra !== undefined && z.safeParse(extra, value).success;

describe('report_write extra frontmatter', () => {
  test('accepts scalars and flat lists', () => {
    expect(accepts({ round: 1, kind: 'range', task: null, repos: ['acme', 'acme-web'] })).toBe(true);
  });

  test('rejects nested objects and lists of objects, which Obsidian shows as raw JSON', () => {
    expect(accepts({ repos: [{ name: 'acme', head: 'abc123' }] })).toBe(false);
    expect(accepts({ owner: { name: 'Ada' } })).toBe(false);
  });
});

describe('report_write', () => {
  test('re-renders the derived views, so the dashboard shows the new report', async () => {
    const tasksMd = join(FOLDERS.PROJECTS, 'TASKS.md');
    mkdirSync(FOLDERS.PROJECTS, { recursive: true });
    rmSync(tasksMd, { force: true });
    await tools
      .find((tool) => tool.name === 'report_write')
      ?.handler({ category: 'radar', slug: 'where-am-i', title: 'Where am I', skill: 'focus', body: 'Two sessions.' });
    expect(existsSync(tasksMd)).toBe(true);
  });
});
