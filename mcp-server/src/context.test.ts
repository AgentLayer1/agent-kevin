import { FOLDERS } from '@/config';
import { pinnedReports } from '@/context';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('pinned reports in the session context', () => {
  test('lists the pins whose file is there, HOME-relative, and reads off with none pinned', () => {
    expect(pinnedReports(600)).toEqual({
      content: null,
      entry: { label: 'pinned reports', status: 'off', bytes: 0, note: 'none pinned' }
    });

    const plans = join(FOLDERS.REPORTS, 'plans');
    mkdirSync(plans, { recursive: true });
    const plan = join(plans, 'auth.md');
    writeFileSync(plan, 'x');
    const pins = join(FOLDERS.REPORTS, 'pinned.md');
    writeFileSync(pins, '# Pinned\n\n- 🛡️ [Auth plan](plans/auth.md)\n- [Gone](plans/gone.html)\n');

    const { content, entry } = pinnedReports(600);
    expect(content).toContain('- 🛡️ Auth plan — reports/plans/auth.md');
    expect(content).not.toContain('Gone');
    expect(entry).toMatchObject({ status: 'loaded', note: '1 pin' });
    [plan, pins].forEach((path) => rmSync(path, { force: true }));
  });
});
