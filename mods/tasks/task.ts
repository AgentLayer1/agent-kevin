import type { PromptAutocompleteSuggestion } from 'claude-code';

import type { TaskCard } from '../types';
import { LIVE_STATUSES } from './statuses';

export interface TaskRow {
  id: string;
  title: string;
  status: string;
  priority?: string;
  project?: string;
  due?: string;
  filePath?: string;
}

/**
 * What `task get` prints: the frontmatter plus the parsed body.
 */
export interface TaskFile {
  frontmatter: TaskRow;
  description: string;
  checklist: readonly { checked: boolean }[];
  filePath: string;
}

const MAX_ROWS = 8;
const DAY_MS = 86_400_000;

export const VERBS = {
  done: { description: 'close it', past: 'Closed', cli: (id: string) => ['task', 'close', id] },
  cancel: {
    description: 'drop it (archive)',
    past: 'Cancelled',
    cli: (id: string) => ['task', 'update', id, '--status=cancelled']
  }
} as const;

export type Verb = keyof typeof VERBS;

const ALIASES: Record<string, Verb> = { archive: 'cancel' };

const isVerb = (name: string): name is Verb => Object.hasOwn(VERBS, name);

export const USAGE = 'Usage: /task <id> [done|cancel]';

type TaskArgs =
  { kind: 'usage' } | { kind: 'unknown-verb'; id: string; verb: string } | { kind: 'task'; id: string; verb?: Verb };

/**
 * Lowercases an id and pads its number to three digits, so `ZX-42` reads as `zx-042`.
 */
export const normalizeId = (raw: string): string => {
  const match = /^([a-z]+)-(\d+)$/i.exec(raw.trim());
  return match ? `${match[1]?.toLowerCase()}-${match[2]?.padStart(3, '0')}` : raw.trim().toLowerCase();
};

export const parseTaskArgs = (args: string): TaskArgs => {
  const [rawId, rawVerb, ...rest] = args.trim().split(/\s+/).filter(Boolean);
  if (rawId === undefined || rest.length > 0) {
    return { kind: 'usage' };
  }
  const id = normalizeId(rawId);
  if (rawVerb === undefined) {
    return { kind: 'task', id };
  }
  const name = rawVerb.toLowerCase();
  const verb = ALIASES[name] ?? name;
  return isVerb(verb) ? { kind: 'task', id, verb } : { kind: 'unknown-verb', id, verb: rawVerb };
};

/**
 * Both verbs act on a live task only: a done task can only be reopened, and a cancelled one is final.
 */
export const isLive = (status: string): boolean => LIVE_STATUSES.includes(status);

const COMMAND = String.raw`^\/(?:[\w-]+:)?task\s+`;
const ID_POSITION = new RegExp(`${COMMAND}$`);
const VERB_POSITION = new RegExp(`${COMMAND}(\\S+)\\s+$`);

type CompletionSlot = { kind: 'id' } | { kind: 'verb'; id: string } | null;

export const completionSlot = (beforeToken: string): CompletionSlot => {
  if (ID_POSITION.test(beforeToken)) {
    return { kind: 'id' };
  }
  const id = VERB_POSITION.exec(beforeToken)?.[1];
  return id ? { kind: 'verb', id: normalizeId(id) } : null;
};

/**
 * Live tasks before closed ones; within each, ids that start with the token before titles that hold it.
 */
export const taskSuggestions = (tasks: readonly TaskRow[], token: string): PromptAutocompleteSuggestion[] => {
  const needle = token.toLowerCase();
  const isIdMatch = (task: TaskRow) => task.id.startsWith(needle);
  const isTitleMatch = (task: TaskRow) => !isIdMatch(task) && task.title.toLowerCase().includes(needle);
  const live = tasks.filter((task) => isLive(task.status));
  const closed = tasks.filter((task) => !isLive(task.status));
  return [live, closed]
    .flatMap((group) => [...group.filter(isIdMatch), ...group.filter(isTitleMatch)])
    .slice(0, MAX_ROWS)
    .map((task) => ({ text: task.id, description: task.title }));
};

export const verbSuggestions = (task: TaskRow | undefined, token: string): PromptAutocompleteSuggestion[] =>
  task === undefined || !isLive(task.status)
    ? []
    : (Object.keys(VERBS) as Verb[])
        .filter((verb) => verb.startsWith(token.toLowerCase()))
        .map((verb) => ({ text: verb, description: VERBS[verb].description }));

const plainText = (markdown: string): string =>
  markdown
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const shortDate = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(Date.parse(iso));

const localDay = (now: number): number =>
  Date.parse(new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now));

export const fileHref = (path: string): string => `file://${encodeURI(path)}`;

export const buildCard = (task: TaskFile, now: number): TaskCard => {
  const { id, title, status, priority, project, due } = task.frontmatter;
  const daysLate = due ? Math.round((localDay(now) - Date.parse(due)) / DAY_MS) : 0;
  const summary = plainText(task.description.split(/\n\s*\n/)[0] ?? '');
  return {
    id,
    title,
    status,
    priority: priority || undefined,
    project: project || undefined,
    due: due ? { label: `due ${shortDate(due)}`, daysLate: isLive(status) && daysLate > 0 ? daysLate : 0 } : undefined,
    summary: summary || undefined,
    checklist: task.checklist.length
      ? { done: task.checklist.filter((item) => item.checked).length, total: task.checklist.length }
      : undefined,
    href: fileHref(task.filePath)
  };
};

/**
 * Cuts text to whole words within `limit` characters, ending in an ellipsis when it cut.
 */
export const clip = (text: string, limit: number): string => {
  if (text.length <= limit) {
    return text;
  }
  const cut = text.slice(0, Math.max(1, limit - 1));
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:]+$/, '')}…`;
};

const BAR_CELLS = 8;

export const progressBar = (done: number, total: number): string => {
  const filled = Math.round((done / total) * BAR_CELLS);
  return `${'▰'.repeat(filled)}${'▱'.repeat(BAR_CELLS - filled)}`;
};

export const STATUS_LOOK: Record<string, { glyph: string; color?: string }> = {
  open: { glyph: '○' },
  active: { glyph: '●', color: 'cyan' },
  blocked: { glyph: '◐', color: 'yellow' },
  done: { glyph: '✓', color: 'green' },
  cancelled: { glyph: '✕' }
};

/**
 * The one line Claude reads about the card the person is looking at.
 */
export const cardSummary = (card: TaskCard): string =>
  [
    `${card.id} · ${card.title}`,
    card.status,
    card.priority,
    card.project,
    card.due?.label,
    card.checklist ? `checklist ${card.checklist.done}/${card.checklist.total}` : undefined
  ]
    .filter(Boolean)
    .join(' · ');
