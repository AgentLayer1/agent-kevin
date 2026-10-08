import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { FILES, PLUGIN_VERSION } from '@/config';
import { nowISO } from '@/shared/date';
import { RUNTIME_DIR, agentKeyName, pluginName } from '@/shared/naming';
import { compareSemver, parseChangelog } from '@/version';
import { readLedger, recordOutcome } from './ledger';
import type { Notice } from './notices';
import { DOWNGRADE_AFTER, applyLedger, collectNotices, syncLevel } from './notices';

const withHome = async <T>(files: Record<string, string>, fn: () => Promise<T>): Promise<T> => {
  const home = mkdtempSync(resolve(tmpdir(), 'notices-test-'));
  mkdirSync(resolve(home, RUNTIME_DIR), { recursive: true });
  Object.entries(files).forEach(([rel, content]) => writeFileSync(resolve(home, RUNTIME_DIR, rel), content));
  const ownKey = agentKeyName('HOME');
  const priorHome = process.env.AGENT_HOME;
  const priorOwn = process.env[ownKey];
  process.env.AGENT_HOME = home;
  delete process.env[ownKey];
  try {
    return await fn();
  } finally {
    if (priorHome === undefined) {
      delete process.env.AGENT_HOME;
    } else {
      process.env.AGENT_HOME = priorHome;
    }
    if (priorOwn !== undefined) {
      process.env[ownKey] = priorOwn;
    }
    rmSync(home, { recursive: true, force: true });
  }
};

const versionAt = (version: string) => ({
  'version.json': JSON.stringify({ plugin: pluginName(), templateVersion: version })
});
const syncedDaysAgo = (days: number) => ({
  'cadence.json': JSON.stringify({ sync: nowISO(new Date(Date.now() - days * 86_400_000)) })
});
const previousRelease = parseChangelog()
  .map((entry) => entry.version)
  .filter((version) => compareSemver(version, PLUGIN_VERSION) < 0)
  .sort(compareSemver)
  .at(-1);

const fixture: Notice = {
  id: 'fixture',
  level: 'alert',
  pinned: false,
  icon: '•',
  label: 'Fixture',
  title: 'Fixture notice',
  facts: [],
  command: `${pluginName()}:fixture`,
  actionLabel: 'Do it'
};

describe('sync escalation', () => {
  test.each([
    [0, null],
    [2, null],
    [3, 'hint'],
    [4, 'hint'],
    [5, 'nudge'],
    [7, 'nudge'],
    [8, 'alert'],
    [30, 'alert'],
    [null, 'alert']
  ] as const)('%p days since the last sync is %p', (age, level) => {
    expect(syncLevel(age)).toBe(level);
  });

  test('a stale home reads its age in the title and calls sync', async () => {
    const notices = await withHome({ ...versionAt(PLUGIN_VERSION), ...syncedDaysAgo(5) }, () => collectNotices());
    expect(notices.map((notice) => [notice.id, notice.level, notice.title, notice.command])).toEqual([
      ['sync', 'nudge', 'Brain 5 days behind', `${pluginName()}:sync`]
    ]);
  });

  test('a pending welcome holds the sync notice back', async () => {
    const notices = await withHome({ ...versionAt(PLUGIN_VERSION), 'cadence.json': '{ "welcome": "pending" }' }, () =>
      collectNotices()
    );
    expect(notices).toEqual([]);
  });
});

describe('upgrade escalation', () => {
  test('one release behind nudges, with the version jump as a fact', async () => {
    expect(previousRelease).toBeDefined();
    const [notice] = await withHome({ ...versionAt(previousRelease ?? ''), ...syncedDaysAgo(0) }, () =>
      collectNotices()
    );
    expect(notice?.level).toBe('nudge');
    expect(notice?.facts[0]).toEqual({ text: `${previousRelease} → ${PLUGIN_VERSION}`, tone: 'accent' });
  });

  test('two or more releases behind alerts', async () => {
    const [notice] = await withHome({ ...versionAt('0.0.1'), ...syncedDaysAgo(0) }, () => collectNotices());
    expect(notice?.level).toBe('alert');
  });

  test('a home with no recorded version nudges to turn tracking on', async () => {
    const [notice] = await withHome(
      { 'version.json': JSON.stringify({ plugin: pluginName() }), ...syncedDaysAgo(0) },
      () => collectNotices()
    );
    expect([notice?.id, notice?.level, notice?.title]).toEqual(['upgrade', 'nudge', 'Turn on update tracking']);
  });

  test('leads sync whatever their levels, since the upgrade ends in a sync', async () => {
    const quiet = await withHome({ ...versionAt(previousRelease ?? ''), ...syncedDaysAgo(9) }, () => collectNotices());
    expect(quiet.map((notice) => [notice.id, notice.level])).toEqual([
      ['upgrade', 'nudge'],
      ['sync', 'alert']
    ]);
  });
});

describe('the ledger', () => {
  const streakOf = (streak: number) => ({
    streaks: { [fixture.id]: streak },
    snoozedThrough: {}
  });

  test(`an unpinned notice drops one level after ${DOWNGRADE_AFTER} snoozes in a row`, () => {
    expect(applyLedger(fixture, streakOf(DOWNGRADE_AFTER - 1), '2026-03-10')?.level).toBe('alert');
    expect(applyLedger(fixture, streakOf(DOWNGRADE_AFTER), '2026-03-10')?.level).toBe('nudge');
    expect(applyLedger({ ...fixture, level: 'hint' }, streakOf(DOWNGRADE_AFTER), '2026-03-10')?.level).toBe('hint');
  });

  test('a pinned notice keeps its level however often it is snoozed', () => {
    expect(applyLedger({ ...fixture, pinned: true }, streakOf(DOWNGRADE_AFTER * 3), '2026-03-10')?.level).toBe('alert');
  });

  test('a snooze hides the notice through the day it was pressed, not the next', () => {
    const ledger = { streaks: {}, snoozedThrough: { [fixture.id]: '2026-03-10' } };
    expect(applyLedger(fixture, ledger, '2026-03-10')).toBeNull();
    expect(applyLedger(fixture, ledger, '2026-03-11')).toEqual(fixture);
  });

  test('acting resets the streak and lifts the snooze; the file survives a reread', async () => {
    const ledger = await withHome({}, async () => {
      recordOutcome('sync', 'snoozed');
      recordOutcome('sync', 'snoozed');
      const snoozed = readLedger();
      recordOutcome('sync', 'acted');
      return { snoozed, acted: readLedger(), path: FILES.NOTICES };
    });
    expect(ledger.snoozed.streaks.sync).toBe(2);
    expect(ledger.snoozed.snoozedThrough.sync).toBeDefined();
    expect(ledger.acted.streaks.sync).toBe(0);
    expect(ledger.acted.snoozedThrough).toEqual({});
    expect(ledger.path).toEndWith(`${RUNTIME_DIR}/notices.json`);
  });

  test('a source that throws costs only itself', async () => {
    const notices = await withHome({}, () =>
      collectNotices([
        async () => {
          throw new Error('boom');
        },
        async () => fixture
      ])
    );
    expect(notices).toEqual([fixture]);
  });
});
