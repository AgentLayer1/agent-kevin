import { describe, expect, test } from 'bun:test';
import { HOME_MARKER_FILES } from '@/shared/naming';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOME_MARKERS } from '../../mods/manuals/repo';
import { MOD_FEATURES } from '../../mods/shared/catalog';

describe('mods', () => {
  test("the instruction loader marks an agent home with the runtime's own marker files", () => {
    expect(HOME_MARKERS).toEqual([...HOME_MARKER_FILES]);
  });

  test('the dashboard catalog lists every feature the module registers', () => {
    const register = readFileSync(resolve(import.meta.dir, '../../mods/hooks/register.ts'), 'utf-8');
    const registered = [...register.matchAll(/from '\.\.\/([\w-]+)\//g)].map((match) => match[1]);
    expect(registered.length).toBeGreaterThan(0);
    expect(MOD_FEATURES.map((feature) => feature.id).sort()).toEqual(registered.sort());
  });
});
