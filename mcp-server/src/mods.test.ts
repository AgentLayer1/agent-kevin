import { describe, expect, test } from 'bun:test';
import { HOME_MARKER_FILES } from '@/shared/naming';
import { HOME_MARKERS } from '../../mods/manuals/repo';

describe('mods', () => {
  test("the instruction loader marks an agent home with the runtime's own marker files", () => {
    expect(HOME_MARKERS).toEqual([...HOME_MARKER_FILES]);
  });
});
