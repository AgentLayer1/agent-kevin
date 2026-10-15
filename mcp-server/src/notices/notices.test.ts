import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { FILES, PLUGIN_VERSION } from '@/config';
import { nowISO, todayDate } from '@/shared/date';
import { RUNTIME_DIR, legacyEnvPrefix, pluginName } from '@/shared/naming';
import { compareSemver, parseChangelog } from '@/version';
import { readLedger, recordOutcome, stampRow } from './ledger';
import type { Notice } from './notices';
import { DOWNGRADE_AFTER, applyLedger, collectNotices, rowDraws, syncLevel } from './notices';

const withHome = async <T>(files: Record<string, string>, fn: () => Promise<T>): Promise<T> => {
  const home = mkdtempSync(resolve(tmpdir(), 'notices-test-'));
  mkdirSync(resolve(home, RUNTIME_DIR), { recursive: true });
  Object.entries(files).forEach(([rel, content]) => writeFileSync(resolve(home, RUNTIME_DIR, rel), content));
  const priorHome = process.env.AGENT_HOME;
  const priorUserDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.AGENT_HOME = home;
  // The operator's own user-level settings stay out of every case.
  process.env.CLAUDE_CONFIG_DIR = resolve(home, 'user-claude');
  try {
    return await fn();
  } finally {
    if (priorHome === undefined) {
      delete process.env.AGENT_HOME;
    } else {
      process.env.AGENT_HOME = priorHome;
    }
    if (priorUserDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = priorUserDir;
    }
    rmSync(home, { recursive: true, force: true });
  }
};

/** Writes `text` at a path relative to the current fixture home, folders included. */
const writeInHome = (rel: string, text: string): void => {
  const file = resolve(process.env.AGENT_HOME ?? '', rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
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

describe('legacy env keys', () => {
  const LEGACY = legacyEnvPrefix();
  const current = () => ({ ...versionAt(PLUGIN_VERSION), ...syncedDaysAgo(0) });

  test('names the legacy keys a home still holds and sends them to the upgrade', async () => {
    const notices = await withHome(current(), () => {
      writeInHome(
        '.claude/settings.local.json',
        JSON.stringify({ env: { [`${LEGACY}CODE_PATH`]: '/code', AGENT_X: '1' } })
      );
      writeInHome(
        '.mcp.json',
        JSON.stringify({ mcpServers: { acme: { command: 'sh', args: ['-c', `d="$${LEGACY}HOME"`] } } })
      );
      return collectNotices();
    });
    expect(notices.map((notice) => notice.id)).toEqual(['legacy-env']);
    expect(notices[0]).toMatchObject({
      level: 'nudge',
      pinned: true,
      title: `2 ${LEGACY}* keys to rename`,
      facts: [
        { text: `${LEGACY}CODE_PATH`, tone: 'warn' },
        { text: `${LEGACY}HOME`, tone: 'warn' }
      ],
      command: `${pluginName()}:upgrade`
    });
  });

  test('flags legacy keys in the user-level settings too', async () => {
    const [notice] = await withHome(current(), () => {
      writeInHome(
        'user-claude/settings.json',
        JSON.stringify({ env: { [`${LEGACY}HOME`]: '/x', AGENT_TIMEZONE: 'UTC' } })
      );
      return collectNotices();
    });
    expect(notice?.facts).toEqual([{ text: `${LEGACY}HOME`, tone: 'warn' }, { text: 'in user settings' }]);
  });

  test('a home on AGENT_* names raises nothing', async () => {
    const notices = await withHome(current(), () => {
      writeInHome('.claude/settings.json', JSON.stringify({ env: { AGENT_CODE_PATH: '/code' } }));
      writeInHome(
        '.mcp.json',
        JSON.stringify({ mcpServers: { acme: { command: 'sh', args: ['-c', 'd="$AGENT_HOME"'] } } })
      );
      return collectNotices();
    });
    expect(notices).toEqual([]);
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

  test('a hand-edited value of the wrong type is dropped, never obeyed', async () => {
    const result = await withHome(
      {
        ...versionAt(PLUGIN_VERSION),
        ...syncedDaysAgo(9),
        'notices.json': JSON.stringify({ streaks: { sync: '4' }, snoozedThrough: { sync: {} }, row: { version: 1 } })
      },
      async () => {
        const shown = await collectNotices();
        recordOutcome('sync', 'snoozed');
        return { shown, ledger: readLedger() };
      }
    );
    expect(result.shown.map((notice) => notice.id)).toEqual(['sync']);
    expect(result.ledger.streaks.sync).toBe(1);
    expect(result.ledger.row).toBeUndefined();
  });

  test('a cadence file that is not an object reads as never synced', async () => {
    const [notice] = await withHome({ ...versionAt(PLUGIN_VERSION), 'cadence.json': 'null' }, () => collectNotices());
    expect([notice?.id, notice?.title]).toEqual(['sync', 'Brain never synced']);
  });

  test('the row proves itself on this version within a week, and a snooze keeps the proof', async () => {
    const proof = await withHome({}, async () => {
      stampRow();
      recordOutcome('sync', 'snoozed');
      return readLedger();
    });
    expect(proof.row?.version).toBe(PLUGIN_VERSION);
    expect(rowDraws(proof)).toBe(true);
    expect(rowDraws({ ...proof, row: { version: '0.0.1', date: todayDate() } })).toBe(false);
    expect(rowDraws({ ...proof, row: { version: PLUGIN_VERSION, date: '2020-01-01' } })).toBe(false);
    expect(rowDraws({ streaks: {}, snoozedThrough: {} })).toBe(false);
  });

  test('`notices record` reads the id wherever it sits among the flags, and refuses a flag as one', async () => {
    const cli = resolve(import.meta.dir, '..', '..', '..', 'bin', pluginName().replace(/^agent-/, ''));
    const result = await withHome({ ...versionAt(PLUGIN_VERSION) }, async () => {
      const home = process.env.AGENT_HOME ?? '';
      const run = (...args: string[]) =>
        spawnSync('bun', [cli, 'notices', 'record', ...args, `--home=${home}`], { encoding: 'utf-8' });
      const snoozed = run('--outcome=snoozed', 'sync');
      const refused = run('--outcome=snoozed');
      return { snoozed: snoozed.status, refused: refused.status, ledger: readLedger() };
    });
    expect(result.snoozed).toBe(0);
    expect(result.refused).toBe(1);
    expect(Object.keys(result.ledger.streaks)).toEqual(['sync']);
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
