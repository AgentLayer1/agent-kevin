import {
  isRecord,
  isScriptSafe,
  jsonBlock,
  readJsonBlock,
  serializeJson,
  type JsonBlockRead
} from '@/shared/json-block';
import { parsePeriod } from '@/tasks/horizon';
import { existsSync, readFileSync } from 'node:fs';

const STATUSES = ['done', 'progress', 'planned'];

export const LEGACY_LITERAL = /\bconst ROADMAP\s*=\s*\{/;
export const ROADMAP_PARSE_LINE = 'const ROADMAP = JSON.parse(document.getElementById("roadmap-data").textContent);';
const TASK_ID = /\b[a-z]{2}-\d{3,}\b/g;

export type RoadmapRead = JsonBlockRead | { kind: 'legacy' };

interface RoadmapItem {
  text: string;
  status: string;
}

export interface RoadmapMilestone {
  chip: string;
  title: string;
  /** The top-level section holding it: its `title`, else `label`, else its key. */
  section: string;
  /** From the nearest `start` / `end` on the milestone or an ancestor; null when undated. */
  window: { start: string; end: string } | null;
  items: RoadmapItem[];
  /** Task ids named in the title or item text. */
  taskIds: string[];
}

export const serializeRoadmapData = (value: unknown): string => serializeJson(value, 'ROADMAP');

export const roadmapDataBlock = (value: unknown): string => jsonBlock('roadmap-data', value, 'ROADMAP');

export const readRoadmapHtml = (html: string): RoadmapRead | null =>
  readJsonBlock(html, 'roadmap-data') ?? (LEGACY_LITERAL.test(html) ? { kind: 'legacy' } : null);

/** null when the file is absent or isn't a roadmap page. */
export const readRoadmapFile = (path: string): RoadmapRead | null =>
  existsSync(path) ? readRoadmapHtml(readFileSync(path, 'utf-8')) : null;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

export const plainText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_match, name: string) => ENTITIES[name] ?? '')
    .trim();

const isItem = (value: unknown): value is RoadmapItem =>
  isRecord(value) && typeof value.text === 'string' && (value.status === undefined || typeof value.status === 'string');

const datedPeriod = (value: unknown): { start: string; end: string } | null => {
  const period = typeof value === 'string' ? parsePeriod(value) : null;
  return period && period.kind !== 'later' ? period : null;
};

const windowOf = (node: Record<string, unknown>): RoadmapMilestone['window'] | undefined => {
  if (node.start === undefined) {
    return undefined;
  }
  const start = datedPeriod(node.start);
  const end = datedPeriod(node.end ?? node.start);
  return start && end && start.start <= end.end ? { start: start.start, end: end.end } : null;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

type MilestoneNode = Record<string, unknown> & { items: RoadmapItem[] };

/** A roadmap page's layout is its own; any object whose items are all `{ text, status }` is a milestone. */
const isMilestone = (node: Record<string, unknown>): node is MilestoneNode =>
  Array.isArray(node.items) && node.items.length > 0 && node.items.every(isItem);

const milestoneOf = (node: MilestoneNode, section: string, window: RoadmapMilestone['window']): RoadmapMilestone => {
  const title = text(node.title) || text(node.theme);
  const items = node.items.map((item) => ({ text: item.text, status: item.status ?? 'planned' }));
  const words = [title, ...items.map((item) => item.text)].map(plainText).join(' ');
  return {
    chip: text(node.chip),
    title,
    section,
    window,
    items,
    taskIds: [...new Set(words.match(TASK_ID) ?? [])]
  };
};

const walk = (node: unknown, section: string, window: RoadmapMilestone['window']): RoadmapMilestone[] => {
  if (Array.isArray(node)) {
    return node.flatMap((child) => walk(child, section, window));
  }
  if (!isRecord(node)) {
    return [];
  }
  const own = windowOf(node);
  const inherited = own === undefined ? window : own;
  if (isMilestone(node)) {
    return [milestoneOf(node, section, inherited)];
  }
  return Object.values(node).flatMap((child) => walk(child, section, inherited));
};

/** Every milestone in a roadmap's data, in page order. */
export const roadmapMilestones = (data: unknown): RoadmapMilestone[] =>
  isRecord(data)
    ? Object.entries(data).flatMap(([key, section]) =>
        walk(section, isRecord(section) ? text(section.title) || text(section.label) || key : key, null)
      )
    : [];

interface RoadmapCheck {
  errors: string[];
  warnings: string[];
}

const merge = (checks: RoadmapCheck[]): RoadmapCheck => ({
  errors: checks.flatMap((check) => check.errors),
  warnings: checks.flatMap((check) => check.warnings)
});

const checkNode = (node: unknown, path: string): RoadmapCheck => {
  if (Array.isArray(node)) {
    return merge(node.map((child, index) => checkNode(child, `${path}[${index}]`)));
  }
  if (!isRecord(node)) {
    return { errors: [], warnings: [] };
  }
  const badDates = (['start', 'end'] as const).filter((key) => node[key] !== undefined && !datedPeriod(node[key]));
  const errors = [
    ...badDates.map(
      (key) => `${path}.${key} "${String(node[key])}" is not a date: use 2026-10-05, 2026-W41 or 2026-10`
    ),
    ...(badDates.length === 0 && windowOf(node) === null ? [`${path}.end comes before its start`] : []),
    ...(isItem(node) && node.status !== undefined && !STATUSES.includes(node.status)
      ? [`${path}.status "${node.status}" must be one of ${STATUSES.join(', ')}`]
      : [])
  ];
  const warnings =
    Array.isArray(node.items) && node.items.length > 0 && !isMilestone(node)
      ? [`${path}.items holds something other than { text, status }, so focus pages skip this milestone`]
      : [];
  const children = Object.entries(node).map(([key, child]) => checkNode(child, `${path}.${key}`));
  return merge([{ errors, warnings }, ...children]);
};

export const checkRoadmapHtml = (html: string): RoadmapCheck => {
  const read = readRoadmapHtml(html);
  if (!read) {
    return { errors: ['no roadmap-data block and no const ROADMAP literal: not a roadmap page'], warnings: [] };
  }
  if (read.kind === 'legacy') {
    return {
      errors: [
        'the data is still a const ROADMAP literal: convert it with run_upgrade { version: "0.5.3" }, never by hand'
      ],
      warnings: []
    };
  }
  if (read.kind === 'invalid') {
    return { errors: [`the roadmap-data block is not valid JSON: ${read.error}`], warnings: [] };
  }
  const unsafe = isScriptSafe(read.raw)
    ? []
    : ['inside the roadmap-data block, write </ as <\\/ and <!-- as <\\u0021--'];
  const check = checkNode(read.data, 'ROADMAP');
  const undated = roadmapMilestones(read.data).filter((milestone) => !milestone.window);
  const dates = undated.length
    ? [
        `${undated.length} milestone(s) have no start date (first: ${[undated[0].chip, undated[0].title].filter(Boolean).join(' ') || undated[0].section}), so focus pages only see their in-progress items`
      ]
    : [];
  return { errors: [...unsafe, ...check.errors], warnings: [...check.warnings, ...dates] };
};
