import type { AgendaItem, TodayView } from '../types';

const OPEN_STATUSES = ['open', 'active'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface TaskFrontmatter {
  id: string;
  title: string;
  status: string;
  priority?: string;
  due?: string;
}

interface TodayInputs {
  emoji: string;
  timezone: string;
  tasks: readonly TaskFrontmatter[];
  syncedAt: string | undefined;
  now: number;
}

export const STALE_SYNC_HOURS = 72;

export const parseEmoji = (identity: string): string => /\*\*Emoji:\*\*\s*(\S+)/.exec(identity)?.[1] ?? '🤖';

const isoDate = (now: number, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const hijriDate = (now: number, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}`;
};

const priorityRank = (priority: string): number => {
  const rank = PRIORITIES.indexOf(priority);
  return rank === -1 ? PRIORITIES.length : rank;
};

/**
 * Most urgent first: priority, then the latest.
 */
const byUrgency = (left: AgendaItem, right: AgendaItem): number =>
  priorityRank(left.priority) - priorityRank(right.priority) || right.daysLate - left.daysLate;

const toItem = (task: TaskFrontmatter, date: string): AgendaItem => ({
  id: task.id,
  priority: task.priority ?? '',
  title: task.title,
  daysLate: Math.round((Date.parse(date) - Date.parse(task.due ?? date)) / DAY_MS)
});

export const buildToday = ({ emoji, timezone, tasks, syncedAt, now }: TodayInputs): TodayView => {
  const date = isoDate(now, timezone);
  const open = tasks.filter((task) => OPEN_STATUSES.includes(task.status) && task.due);
  const syncedMs = syncedAt === undefined ? Number.NaN : Date.parse(syncedAt);
  return {
    emoji,
    dateLabel: new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    }).format(now),
    hijriLabel: hijriDate(now, timezone),
    overdue: open
      .filter((task) => (task.due ?? '') < date)
      .map((task) => toItem(task, date))
      .sort(byUrgency),
    dueToday: open
      .filter((task) => task.due === date)
      .map((task) => toItem(task, date))
      .sort(byUrgency),
    syncAgeHours: Number.isNaN(syncedMs) ? null : Math.floor((now - syncedMs) / HOUR_MS)
  };
};

export const formatAge = (hours: number): string =>
  hours < 1 ? 'just now' : hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;

/**
 * The one line Claude reads; the transcript draws the agenda from the stored view.
 */
export const summarize = (view: TodayView): string => {
  const ids = (list: readonly AgendaItem[]) => (list.length ? ` (${list.map((item) => item.id).join(', ')})` : '');
  return [
    `${view.emoji} ${view.overdue.length} overdue${ids(view.overdue)}`,
    `${view.dueToday.length} due today${ids(view.dueToday)}`,
    view.syncAgeHours === null ? 'never synced' : `synced ${formatAge(view.syncAgeHours)}`
  ].join(' · ');
};
