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
import { CONTEXT, FOLDERS, TIMEZONE } from '@/config';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: TIMEZONE
  });

  const gitLog = recentGitLog(FOLDERS.KNOWLEDGE);

  const entries: ManifestEntry[] = [
    tail.entry,
    {
      label: 'git activity',
      status: gitLog ? 'loaded' : 'unavailable',
      bytes: gitLog?.length ?? 0,
      note: gitLog ? `${gitLog.split('\n').length} commits` : undefined
    }
  ];

  const parts: string[] = [`## Today\n${dateStr} (${TIMEZONE})`];
  if (tail.content) parts.push(`## Last Session Tail\n\n${tail.content}`);
  if (gitLog) parts.push(`## Recent Git Activity\n\n\`\`\`\n${gitLog}\n\`\`\``);

  let context = parts.join('\n\n---\n\n');
  if (context.length > CONTEXT.MAX_CHARS) {
    context = context.slice(0, CONTEXT.MAX_CHARS) + '\n\n...(truncated)';
  }
  const banner = renderBanner(entries, context.length);
  const hasIssues = entries.some((e) => e.status !== 'loaded');
  return { context, banner, hasIssues };
}
