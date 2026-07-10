/**
 * Reports helper.
 *
 * Reporting skills (briefings, goals, self-review, flywheel) write their
 * artefacts via `writeReport`. The helper does three things in one shot:
 *
 *   1. Render frontmatter + body to `reports/<category>/YYYY-MM-DD-HHMM-<slug><ext>`
 *      (atomic temp+rename).
 *   2. Read `reports/index.md`, insert a one-line entry under today's `##` heading
 *      (creating the heading if absent), and atomically write the index back.
 *   3. Return the absolute + relative paths so the caller can surface them to the
 *      operator.
 *
 * A per-process promise queue serialises concurrent calls so two skills writing
 * at the same time can't clobber the index.
 */
import { FILES, FOLDERS } from '@/config';
import { nowISO, nowTimeCompact, todayDate } from '@/shared/date';
import { writeFileAtomic } from '@/shared/utils';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

export type ReportCategory = 'briefings' | 'plans' | 'radar' | 'permissions';

export type ReportStatus = 'clean' | 'findings' | 'critical' | 'draft';

export interface WriteReportInput {
  category: ReportCategory;
  slug: string;
  title: string;
  skill: string;
  body: string;
  summary?: string;
  status?: ReportStatus;
  tags?: string[];
  /** Skill-specific frontmatter keys appended after the standard ones. */
  extra?: Record<string, unknown>;
  /** Defaults to `.md`. Use `.plan-spec.md` for spec-shaped outputs. */
  ext?: '.md' | '.plan-spec.md';
}

export interface WriteReportResult {
  path: string;
  relPath: string;
  indexUpdated: boolean;
}

const STATUS_ICON: Record<ReportStatus, string> = {
  clean: '🟢',
  findings: '🟠',
  critical: '🔴',
  draft: '⏳'
};

const INDEX_PREAMBLE = `# Reports

> Auto-maintained by the agent-kevin \`writeReport\` helper. Newest first within each day.
`;

let queue: Promise<unknown> = Promise.resolve();

/**
 * Serialise writeReport calls. The index file is read-modify-write; without a
 * mutex two concurrent calls could each read the same baseline and the second
 * write would lose the first call's insertion.
 */
const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
};

export async function writeReport(input: WriteReportInput): Promise<WriteReportResult> {
  return enqueue(() => doWriteReport(input));
}

async function doWriteReport(input: WriteReportInput): Promise<WriteReportResult> {
  const ext = input.ext ?? '.md';
  const now = new Date();
  const date = todayDate(now);
  const time = nowTimeCompact(now);
  const created = nowISO(now);

  const dir = resolve(FOLDERS.REPORTS, input.category);
  await mkdir(dir, { recursive: true });

  const { path: filePath, fileName } = await resolveAvailablePath(dir, date, time, input.slug, ext);

  const content = renderReport(input, created);
  writeFileAtomic(filePath, content);

  const relPath = relative(FOLDERS.REPORTS, filePath);
  const linkPath = `${input.category}/${fileName}`;
  const indexUpdated = await updateIndex({
    date,
    time,
    title: input.title,
    skill: input.skill,
    status: input.status,
    linkPath
  });

  return { path: filePath, relPath, indexUpdated };
}

async function resolveAvailablePath(
  dir: string,
  date: string,
  time: string,
  slug: string,
  ext: string
): Promise<{ path: string; fileName: string }> {
  const base = `${date}-${time}-${slug}`;
  for (let suffix = 0; suffix < 100; suffix++) {
    const fileName = suffix === 0 ? `${base}${ext}` : `${base}-${suffix}${ext}`;
    const candidate = resolve(dir, fileName);
    if (!existsSync(candidate)) return { path: candidate, fileName };
  }
  throw new Error(`writeReport: too many collisions for ${base}${ext} in ${dir}`);
}

function renderReport(input: WriteReportInput, created: string): string {
  const fmLines: string[] = ['---'];
  fmLines.push(`title: ${yamlScalar(input.title)}`);
  fmLines.push(`skill: ${yamlScalar(input.skill)}`);
  fmLines.push(`created: ${created}`);
  if (input.summary) fmLines.push(`summary: ${yamlScalar(input.summary)}`);
  if (input.status) fmLines.push(`status: ${input.status}`);
  if (input.tags && input.tags.length > 0) {
    fmLines.push(`tags: [${input.tags.map(yamlScalar).join(', ')}]`);
  }
  if (input.extra) {
    for (const [key, value] of Object.entries(input.extra)) {
      fmLines.push(`${key}: ${yamlValue(value)}`);
    }
  }
  fmLines.push('---', '');

  const body = input.body.endsWith('\n') ? input.body : input.body + '\n';
  return fmLines.join('\n') + body;
}

function yamlScalar(value: string): string {
  // Quote when the value contains YAML-significant characters or has leading
  // whitespace / a leading `-` (list marker). Mid-value hyphens are fine bare.
  if (/^\s|\s$|^-|[:#?{}\[\],&*!|>'%@`"]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function yamlValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return yamlScalar(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map(yamlValue).join(', ')}]`;
  }
  return JSON.stringify(value);
}

interface IndexEntry {
  date: string;
  time: string;
  title: string;
  skill: string;
  status?: ReportStatus;
  linkPath: string;
}

async function updateIndex(entry: IndexEntry): Promise<boolean> {
  await mkdir(FOLDERS.REPORTS, { recursive: true });
  const existing = await readIndexOrInit();
  const next = insertEntry(existing, entry);
  if (next === existing) return false;
  writeFileAtomic(FILES.REPORTS_INDEX, next);
  return true;
}

async function readIndexOrInit(): Promise<string> {
  try {
    return await readFile(FILES.REPORTS_INDEX, 'utf-8');
  } catch {
    return INDEX_PREAMBLE;
  }
}

export function insertEntry(content: string, entry: IndexEntry): string {
  const bullet = renderBullet(entry);
  const heading = `## ${entry.date}`;
  const lines = content.split('\n');

  const headingIdx = lines.findIndex((line) => line.trim() === heading);
  if (headingIdx !== -1) {
    // Insert bullet as first entry under the heading (after the blank line that
    // typically follows). If next line is non-blank, we still insert directly
    // after the heading and prepend a blank line for readability.
    const insertAt = lines[headingIdx + 1]?.trim() === '' ? headingIdx + 2 : headingIdx + 1;
    lines.splice(insertAt, 0, bullet);
    return lines.join('\n');
  }

  // No section for this date yet. Insert a new section immediately after the
  // preamble (before any older date section), so newest dates stay at top.
  const insertAt = findFirstSectionIndex(lines);
  const section = ['', heading, '', bullet, ''];
  lines.splice(insertAt, 0, ...section);
  return lines.join('\n');
}

function findFirstSectionIndex(lines: string[]): number {
  // First location matching `## YYYY-MM-DD`. If none, append at end.
  for (let i = 0; i < lines.length; i++) {
    if (/^## \d{4}-\d{2}-\d{2}\s*$/.test(lines[i] ?? '')) return i;
  }
  // No existing dated section. Append at the end (but trim trailing blank).
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') end--;
  return end;
}

function renderBullet(entry: IndexEntry): string {
  const hhmm = `${entry.time.slice(0, 2)}:${entry.time.slice(2, 4)}`;
  const parts = [`- ${hhmm} · [${entry.title}](${entry.linkPath}) · \`${entry.skill}\``];
  if (entry.status) parts.push(`· ${STATUS_ICON[entry.status]} ${entry.status}`);
  return parts.join(' ');
}
