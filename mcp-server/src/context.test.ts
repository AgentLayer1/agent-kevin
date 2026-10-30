import { FILES, FOLDERS, TIMEZONE } from '@/config';
import { pinnedReports, subscriptionIssue, todaysReports } from '@/context';
import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe("today's reports in the session context", () => {
  test('a section over the cap is cut at the last whole entry', async () => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
    const entry = (index: number) => `- 09:0${index} · [Report ${index}](plans/report-${index}.md) · \`plan-spec\``;
    mkdirSync(FOLDERS.REPORTS, { recursive: true });
    writeFileSync(FILES.REPORTS_INDEX, `# Reports\n\n## ${today}\n\n${[1, 2, 3].map(entry).join('\n')}\n`);

    const { content } = await todaysReports(entry(1).length + entry(2).length / 2);
    expect(content).toBe(`${entry(1)}\n…(see reports/index.md)`);
    rmSync(FILES.REPORTS_INDEX, { force: true });
  });

  test('a first entry longer than the cap is left out whole, not cut mid-link', async () => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
    mkdirSync(FOLDERS.REPORTS, { recursive: true });
    writeFileSync(FILES.REPORTS_INDEX, `# Reports\n\n## ${today}\n\n- 09:00 · [A long one](plans/a-long-one.md)\n`);

    expect((await todaysReports(10)).content).toBe('…(see reports/index.md)');
    rmSync(FILES.REPORTS_INDEX, { force: true });
  });
});

describe('pinned reports in the session context', () => {
  test('lists the pins whose file is there, HOME-relative, and reads off with none pinned', () => {
    expect(pinnedReports(10)).toEqual({
      content: null,
      entry: { label: 'pinned reports', status: 'off', bytes: 0, note: 'none pinned' }
    });

    const plans = join(FOLDERS.REPORTS, 'plans');
    mkdirSync(plans, { recursive: true });
    const plan = join(plans, 'auth.md');
    writeFileSync(plan, 'x');
    const pins = join(FOLDERS.REPORTS, 'pinned.md');
    writeFileSync(pins, '# Pinned\n\n- 🛡️ [Auth plan](plans/auth.md)\n- [Gone](plans/gone.html)\n');

    const { content, entry } = pinnedReports(10);
    expect(content).toContain('- 🛡️ Auth plan — reports/plans/auth.md');
    expect(content).not.toContain('Gone');
    expect(entry).toMatchObject({ status: 'loaded', note: '1 pin' });
    expect(pinnedReports(0).content).toEndWith('\n…1 more in reports/pinned.md');
    [plan, pins].forEach((path) => rmSync(path, { force: true }));
  });
});

describe('the Claude subscription guard', () => {
  test('a home with its own subscription warns when the session started without it', () => {
    expect(subscriptionIssue(true, undefined)).toContain('then run "agent"');
  });

  test('a session started with the subscription file, or a home without one, stays quiet', () => {
    expect(subscriptionIssue(true, '1')).toBeNull();
    expect(subscriptionIssue(false, undefined)).toBeNull();
  });
});
