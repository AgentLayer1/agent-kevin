/**
 * Per-session DYNAMIC context preamble.
 *
 * Static identity (SOUL, IDENTITY, USER, CLAUDE) and knowledge indexes are
 * loaded natively by Claude Code via `@-imports` inside `<HOME>/CLAUDE.md` —
 * no hook involvement needed when CC opens in (or under) KEVIN_HOME.
 *
 * This hook only injects what CC can't know from files alone: today's date in
 * the user's timezone, the tail of yesterday's session log for continuity, and
 * recent git activity. Caps at ~10KB per CC's hook limit, but usually fits in
 * a few KB.
 */
import { CONTEXT, EXTRA_GIT_REPOS, FILES, FOLDERS, TIMEZONE } from '@/config';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  FIRST_SESSION_HEADER_RE,
  SESSION_BLOCK_SEPARATOR_RE,
  TRAILING_SEPARATOR_RE,
} from './knowledge/session-format';

interface ManifestEntry {
  label: string;
  status: 'loaded' | 'missing' | 'unavailable';
  bytes: number;
  note?: string;
}

function recentGitLog(cwd: string): string | null {
  try {
    const output = execSync(`git log --oneline --format="%h %s (%ar)" -${CONTEXT.MAX_GIT_LOG_COMMITS}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 5_000
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export function findLastSessionBlockStart(content: string): number {
  let lastSeparator = -1;
  for (const match of content.matchAll(SESSION_BLOCK_SEPARATOR_RE)) {
    lastSeparator = (match.index ?? 0) + match[0].length;
  }
  if (lastSeparator !== -1) return lastSeparator;
  const firstHeader = content.match(FIRST_SESSION_HEADER_RE);
  return firstHeader && firstHeader.index !== undefined ? firstHeader.index : -1;
}

interface TailResult {
  content: string | null;
  entry: ManifestEntry;
}

async function lastSessionTail(maxBytes: number): Promise<TailResult> {
  const now = new Date();
  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    const dateStr = day.toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
    const filename = `${dateStr}.md`;
    const logPath = resolve(FOLDERS.SESSIONS, filename);
    try {
      const content = await readFile(logPath, 'utf-8');
      const start = findLastSessionBlockStart(content);
      if (start === -1) continue;
      const block = content.slice(start).replace(TRAILING_SEPARATOR_RE, '');
      const truncated =
        block.length > maxBytes
          ? `${block.slice(0, maxBytes).trimEnd()}\n\n_(truncated — full block in \`${logPath}\`)_`
          : block;
      return {
        content: truncated,
        entry: {
          label: 'session tail',
          status: 'loaded',
          bytes: truncated.length,
          note: offset === 0 ? filename : `${filename}, ${offset}d ago`
        }
      };
    } catch {
      // try previous day
    }
  }
  return { content: null, entry: { label: 'session tail', status: 'missing', bytes: 0 } };
}

interface ReportsResult {
  content: string | null;
  entry: ManifestEntry;
}

/**
 * Slice today's section out of `reports/index.md` and return it verbatim. The
 * index file is the source of truth — written transactionally by `writeReport`
 * alongside each report file, so it's always current.
 */
async function todaysReports(maxBytes: number): Promise<ReportsResult> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
  let raw: string;
  try {
    raw = await readFile(FILES.REPORTS_INDEX, 'utf-8');
  } catch {
    return { content: null, entry: { label: "today's reports", status: 'missing', bytes: 0 } };
  }

  const lines = raw.split('\n');
  const headingIdx = lines.findIndex((line) => line.trim() === `## ${today}`);
  if (headingIdx === -1) {
    return { content: null, entry: { label: "today's reports", status: 'missing', bytes: 0, note: 'no entries today' } };
  }

  // Take lines after the heading until the next `## ` heading or EOF.
  let end = headingIdx + 1;
  while (end < lines.length && !/^## /.test(lines[end] ?? '')) end++;
  const sectionLines = lines.slice(headingIdx + 1, end);
  // Trim leading/trailing blank lines.
  while (sectionLines.length > 0 && sectionLines[0]?.trim() === '') sectionLines.shift();
  while (sectionLines.length > 0 && sectionLines[sectionLines.length - 1]?.trim() === '') sectionLines.pop();
  if (sectionLines.length === 0) {
    return { content: null, entry: { label: "today's reports", status: 'missing', bytes: 0, note: 'heading empty' } };
  }

  let body = sectionLines.join('\n');
  if (body.length > maxBytes) {
    body = `${body.slice(0, maxBytes).trimEnd()}\n…(see reports/index.md)`;
  }

  return {
    content: body,
    entry: {
      label: "today's reports",
      status: 'loaded',
      bytes: body.length,
      note: `${sectionLines.filter((line) => line.startsWith('- ')).length} entries`
    }
  };
}

const formatKB = (bytes: number) => `${(bytes / 1024).toFixed(1)}KB`;

const STATUS_ICON: Record<ManifestEntry['status'], string> = {
  loaded: '✓',
  missing: '✗',
  unavailable: '⚠'
};

function renderBanner(entries: ManifestEntry[], contextBytes: number): string {
  const labelWidth = Math.max(...entries.map((e) => e.label.length), 12);
  const sizeWidth = Math.max(...entries.map((e) => formatKB(e.bytes).length));
  const lines = entries.map((e) => {
    const label = e.label.padEnd(labelWidth);
    const size = formatKB(e.bytes).padStart(sizeWidth);
    const note = e.note ? `  (${e.note})` : '';
    return `    ${STATUS_ICON[e.status]} ${label}  ${size}${note}`;
  });
  const head = [
    `  🤖 Agent:     Kevin`,
    `  🧠 Knowledge: ${FOLDERS.KNOWLEDGE}`,
    `  📁 Projects:  ${FOLDERS.PROJECTS}`,
    `  📚 Context  · ${formatKB(contextBytes)}`
  ];
  return [...head, ...lines].join('\n');
}

export interface AssembledContext {
  context: string;
  banner: string;
  hasIssues: boolean;
}

export async function assembleContext(): Promise<AssembledContext> {
  const tail = await lastSessionTail(CONTEXT.SESSION_TAIL_BYTES);
  const reports = await todaysReports(CONTEXT.REPORTS_BYTES);

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: TIMEZONE
  });

  const repos: { label: string; path: string }[] = [
    { label: 'knowledge', path: FOLDERS.KNOWLEDGE },
    ...EXTRA_GIT_REPOS.map((path) => ({ label: basename(path), path }))
  ];
  const gitLogs = repos.map((repo) => ({ ...repo, output: recentGitLog(repo.path) }));

  const entries: ManifestEntry[] = [
    tail.entry,
    reports.entry,
    ...gitLogs.map((log) => ({
      label: `git: ${log.label}`,
      status: (log.output ? 'loaded' : 'unavailable') as ManifestEntry['status'],
      bytes: log.output?.length ?? 0,
      note: log.output ? `${log.output.split('\n').length} commits` : undefined
    }))
  ];

  const parts: string[] = [`## Today\n${dateStr} (${TIMEZONE})`];
  if (tail.content) parts.push(`## Last Session Tail\n\n${tail.content}`);
  if (reports.content) parts.push(`## Today's Reports\n\n${reports.content}`);

  const gitSections = gitLogs
    .filter((log) => log.output)
    .map((log) => `### ${log.label}\n\n\`\`\`\n${log.output}\n\`\`\``);
  if (gitSections.length > 0) parts.push(`## Recent Git Activity\n\n${gitSections.join('\n\n')}`);

  let context = parts.join('\n\n---\n\n');
  if (context.length > CONTEXT.MAX_CHARS) {
    context = context.slice(0, CONTEXT.MAX_CHARS) + '\n\n...(truncated)';
  }
  const banner = renderBanner(entries, context.length);
  const hasIssues = entries.some((e) => e.status !== 'loaded');
  return { context, banner, hasIssues };
}
