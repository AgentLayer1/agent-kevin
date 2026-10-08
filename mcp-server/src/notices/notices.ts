import { PLUGIN_NAME, PLUGIN_VERSION } from '@/config';
import { getStatus } from '@/knowledge/compile';
import { readCadence } from '@/shared/cadence';
import { daysBetween, todayDate } from '@/shared/date';
import { countOf } from '@/shared/utils';
import { getUpgradeStatus } from '@/version';
import type { NoticeLedger } from './ledger';
import { readLedger } from './ledger';

const LEVELS = ['hint', 'nudge', 'alert'] as const;
export type NoticeLevel = (typeof LEVELS)[number];

export interface NoticeFact {
  text: string;
  tone?: 'accent' | 'warn';
}

/**
 * Something the operator should do, worked out from the home's state each time it is read. The
 * level decides where it shows: hint in the banner and the prompt suggestion, nudge adds the row
 * above the prompt, alert adds a toast at session start.
 */
export interface Notice {
  id: string;
  level: NoticeLevel;
  /** A pinned notice keeps its level however often it is snoozed. */
  pinned: boolean;
  icon: string;
  label: string;
  title: string;
  facts: NoticeFact[];
  /** The slash command that acts on it, without the slash. */
  command: string;
  actionLabel: string;
}

type NoticeSource = () => Promise<Notice | null>;

/** Consecutive snoozes that drop an unpinned notice one level. */
export const DOWNGRADE_AFTER = 5;

/** How long a stamp from the prompt row stands as proof that it draws notices on this machine. */
const ROW_PROOF_DAYS = 7;

/** Calendar days since the last sync at which each level starts. */
const SYNC_DAYS = { hint: 3, nudge: 5, alert: 8 } as const;

/**
 * Calendar days since `stamp` in the operator's timezone, or `null` without a valid stamp.
 */
const daysSince = (stamp: string | undefined): number | null => {
  const at = Date.parse(stamp ?? '');
  return Number.isNaN(at) ? null : daysBetween(todayDate(new Date(at)), todayDate());
};

/**
 * Never synced is as loud as the oldest stamp.
 */
export const syncLevel = (age: number | null): NoticeLevel | null => {
  if (age === null || age >= SYNC_DAYS.alert) {
    return 'alert';
  }
  if (age >= SYNC_DAYS.nudge) {
    return 'nudge';
  }
  return age >= SYNC_DAYS.hint ? 'hint' : null;
};

const upgradeNotice: NoticeSource = async () => {
  const status = getUpgradeStatus();
  if (status.state === 'current') {
    return null;
  }
  const base = {
    id: 'upgrade',
    pinned: true,
    icon: '↑',
    label: 'Upgrade',
    command: `${PLUGIN_NAME}:upgrade`,
    actionLabel: 'Upgrade now'
  };
  if (status.state === 'onboard') {
    return { ...base, level: 'nudge', title: 'Turn on update tracking', facts: [] };
  }
  return {
    ...base,
    level: status.releasesBehind >= 2 ? 'alert' : 'nudge',
    title: 'Upgrade ready',
    facts: [
      { text: `${status.baseline} → ${status.installed}`, tone: 'accent' },
      { text: `${countOf(status.releasesBehind, 'release')} behind` }
    ]
  };
};

const syncNotice: NoticeSource = async () => {
  const cadence = readCadence();
  if (cadence.welcome === 'pending') {
    return null;
  }
  const age = daysSince(cadence.sync);
  const level = syncLevel(age);
  if (level === null) {
    return null;
  }
  const pending = await getStatus()
    .then((status) => status.pending)
    .catch(() => null);
  const backlog = pending
    ? [
        pending.sessions ? countOf(pending.sessions, 'session log') : '',
        pending.inbox ? `${pending.inbox} in the inbox` : '',
        pending.feedback ? 'new feedback' : ''
      ].filter(Boolean)
    : [];
  return {
    id: 'sync',
    level,
    pinned: true,
    icon: '⟳',
    label: 'Sync',
    title: age === null ? 'Brain never synced' : `Brain ${countOf(age, 'day')} behind`,
    facts: backlog.map((text) => ({ text, tone: 'warn' as const })),
    command: `${PLUGIN_NAME}:sync`,
    actionLabel: 'Sync now'
  };
};

// The order is the priority. Upgrade leads because it ends in a sync, or asks for one after a restart.
const SOURCES: readonly NoticeSource[] = [upgradeNotice, syncNotice];

/**
 * Hides a notice snoozed through today and drops an unpinned one a level once it has been
 * snoozed `DOWNGRADE_AFTER` times in a row; hint is the floor.
 */
export const applyLedger = (notice: Notice, ledger: NoticeLedger, today: string): Notice | null => {
  if ((ledger.snoozedThrough[notice.id] ?? '') >= today) {
    return null;
  }
  const streak = ledger.streaks[notice.id] ?? 0;
  if (notice.pinned || streak < DOWNGRADE_AFTER) {
    return notice;
  }
  return { ...notice, level: LEVELS[Math.max(0, LEVELS.indexOf(notice.level) - 1)] ?? 'hint' };
};

/**
 * Every notice that applies now, in priority order; every surface leads with the first. A source
 * that throws is left out rather than costing the others.
 */
/**
 * True when the prompt row fetched notices on this plugin version within the last week: the
 * evidence the terminal banner needs before it leaves nudges and alerts to the row.
 */
export const rowDraws = (ledger: NoticeLedger = readLedger()): boolean =>
  ledger.row?.version === PLUGIN_VERSION && daysBetween(ledger.row.date, todayDate()) <= ROW_PROOF_DAYS;

export const collectNotices = async (sources: readonly NoticeSource[] = SOURCES): Promise<Notice[]> => {
  const ledger = readLedger();
  const today = todayDate();
  const found = await Promise.all(sources.map((source) => source().catch(() => null)));
  return found
    .filter((notice): notice is Notice => notice !== null)
    .map((notice) => applyLedger(notice, ledger, today))
    .filter((notice): notice is Notice => notice !== null);
};
