import { describe, expect, test } from 'bun:test';
import { HOME_MARKER_FILES, RUNTIME_DIR } from '@/shared/naming';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, HOME_MARKERS } from '../../mods/manuals/repo';
import { LIVE_STATUSES } from '../../mods/tasks/statuses';
import { isValidTransition } from './tasks/schema';
import type { TaskStatus } from './shared/types';
import { MOD_FEATURES } from '../../mods/shared/catalog';

describe('mods', () => {
  test("the instruction loader marks an agent home with the runtime's own marker files", () => {
    expect(HOME_MARKERS).toEqual([...HOME_MARKER_FILES]);
  });

  test("the setup prompt looks for the runtime's own data dir", () => {
    expect(DATA_DIR).toBe(RUNTIME_DIR);
  });

  test("/task's done and cancel act on exactly the statuses the task schema can close or cancel", () => {
    const statuses: readonly TaskStatus[] = ['open', 'active', 'blocked', 'done', 'cancelled'];
    const closable = statuses.filter(
      (status) =>
        isValidTransition(status, 'cancelled') &&
        (isValidTransition(status, 'done') || isValidTransition(status, 'active'))
    );
    expect<readonly string[]>(closable).toEqual(LIVE_STATUSES);
  });

  test('the dashboard catalog lists every feature the module registers', () => {
    const register = readFileSync(resolve(import.meta.dir, '../../mods/hooks/register.ts'), 'utf-8');
    const registered = [...register.matchAll(/from '\.\.\/([\w-]+)\//g)].map((match) => match[1]);
    expect(registered.length).toBeGreaterThan(0);
    expect(MOD_FEATURES.map((feature) => feature.id).sort()).toEqual(registered.sort());
  });
});
