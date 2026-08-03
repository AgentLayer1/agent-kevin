#!/usr/bin/env bun
/**
 * List Claude Code sessions active in the last N hours across all projects.
 *
 * Scans ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl, extracts per-session
 * metadata, and prints JSON sorted by last activity (most recent first).
 * Read-only, no network. Run with `bun`.
 *
 * Usage: bun list_sessions.ts [--hours 24] [--scope <path>[,<path>...]|all]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const USER_SNIPPET = 400;
const ASSISTANT_SNIPPET = 1500;
const RECENT_USER_MSGS = 3;

interface ContentBlock {
  type?: string;
  text?: string;
}

interface SessionRecord {
  type?: string;
  aiTitle?: string;
  customTitle?: string;
  isSidechain?: boolean;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  message?: { content?: string | ContentBlock[] };
}

interface SessionInfo {
  session_id: string;
  file: string;
  title: string | null;
  cwd: string | null;
  git_branch: string | null;
  first_user_msg: string | null;
  recent_user_msgs: string[];
  last_assistant_text: string | null;
  user_turns: number;
  started: string | null;
  last_timestamp: string | null;
  last_active: string;
  minutes_ago: number;
}

/** Parse `--key value` and `--key=value` flags into a map. */
const readFlags = (argv: readonly string[]): Map<string, string> => {
  const flags = new Map<string, string>();
  argv.forEach((token, index) => {
    if (!token.startsWith('--')) {
      return;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      flags.set(token.slice(2, eq), token.slice(eq + 1));
      return;
    }
    const next = argv[index + 1];
    flags.set(token.slice(2), next !== undefined && !next.startsWith('--') ? next : '');
  });
  return flags;
};

/** Local-timezone ISO timestamp with minute precision (e.g. 2026-06-13T16:50+08:00). */
const toLocalIsoMinutes = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}` +
    `${sign}${pad(Math.floor(absMinutes / 60))}:${pad(absMinutes % 60)}`
  );
};

/** Transcript dirs encode the launch cwd with non-alphanumerics flattened to "-". */
const encodeCwd = (path: string): string => path.replace(/[^A-Za-z0-9-]/g, '-');

const inScope = (projectDir: string, encodedScope: string): boolean =>
  projectDir === encodedScope || projectDir.startsWith(`${encodedScope}-`);

const isRealUserText = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('[Request interrupted')) {
    return false;
  }
  return !trimmed.startsWith('Base directory for this skill:'); // injected skill payloads
};

/** Truncate by Unicode code point (matches Python string slicing, not UTF-16 units). */
const clip = (text: string, max: number): string => [...text].slice(0, max).join('');

const blockText = (block: ContentBlock): string | null =>
  block.type === 'text' && typeof block.text === 'string' ? block.text : null;

const userTexts = (record: SessionRecord): string[] => {
  const content = record.message?.content;
  if (typeof content === 'string') {
    return isRealUserText(content) ? [content] : [];
  }
  if (Array.isArray(content)) {
    return content.map(blockText).filter((text): text is string => text !== null && isRealUserText(text));
  }
  return [];
};

const assistantTexts = (record: SessionRecord): string[] => {
  const content = record.message?.content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.map(blockText).filter((text): text is string => text !== null && text.trim().length > 0);
};

const parseRecords = (raw: string): SessionRecord[] =>
  raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line) as SessionRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is SessionRecord => record !== null);

/** Last truthy value of `field` across records (mirrors Python's `x = rec.field or x`). */
const lastTruthy = (
  records: readonly SessionRecord[],
  pick: (record: SessionRecord) => string | undefined
): string | null =>
  records
    .map(pick)
    .filter((value): value is string => Boolean(value))
    .at(-1) ?? null;

const buildInfo = (path: string, mtimeMs: number, now: number): SessionInfo => {
  const records = parseRecords(readFileSync(path, 'utf-8'));

  // `/rename` writes a custom-title record; Claude Code itself prefers it over the
  // first-prompt ai-title, so an operator-set name wins here too.
  const customTitle = records.filter((record) => record.type === 'custom-title' && record.customTitle).at(-1)?.customTitle;
  const aiTitle = records.filter((record) => record.type === 'ai-title' && record.aiTitle).at(-1)?.aiTitle;
  const title = customTitle ?? aiTitle ?? null;

  // Everything except title records and sidechains contributes timing/cwd/turns.
  const body = records.filter(
    (record) => record.type !== 'ai-title' && record.type !== 'custom-title' && !record.isSidechain
  );
  const timestamps = body.map((record) => record.timestamp).filter((ts): ts is string => Boolean(ts));

  const userMessages = body
    .filter((record) => record.type === 'user')
    .map(userTexts)
    .filter((texts) => texts.length > 0);

  const assistantFlat = body.filter((record) => record.type === 'assistant').flatMap(assistantTexts);

  return {
    session_id: basename(path).replace(/\.jsonl$/, ''),
    file: path,
    title,
    cwd: lastTruthy(body, (record) => record.cwd),
    git_branch: lastTruthy(body, (record) => record.gitBranch),
    first_user_msg: userMessages.length > 0 ? clip(userMessages[0][0], USER_SNIPPET) : null,
    recent_user_msgs: userMessages.slice(-RECENT_USER_MSGS).map((texts) => clip(texts[texts.length - 1], USER_SNIPPET)),
    last_assistant_text:
      assistantFlat.length > 0 ? clip(assistantFlat[assistantFlat.length - 1], ASSISTANT_SNIPPET) : null,
    user_turns: userMessages.length,
    started: timestamps[0] ?? null,
    last_timestamp: timestamps.at(-1) ?? null,
    last_active: toLocalIsoMinutes(new Date(mtimeMs)),
    minutes_ago: Math.floor((now - mtimeMs) / 60_000)
  };
};

const listTranscripts = (root: string): string[] =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((dir) =>
          readdirSync(join(root, dir.name))
            .filter((name) => name.endsWith('.jsonl'))
            .map((name) => join(root, dir.name, name))
        )
    : [];

const flags = readFlags(process.argv.slice(2));
const hoursFlag = flags.get('hours');
const hours =
  hoursFlag !== undefined && !Number.isNaN(Number.parseFloat(hoursFlag)) ? Number.parseFloat(hoursFlag) : 24;
// Multiple roots (comma-separated) because the agent HOME and the code repos
// live in separate trees — a single cwd-rooted scope would go blind to one or
// the other. Worktrees come free: they're siblings named <repo>-<slug>, which
// the encoded prefix match already covers.
const scopeFlag = flags.get('scope');
const scopes =
  scopeFlag === 'all'
    ? null
    : [
        ...new Set(
          (scopeFlag || process.cwd())
            .split(',')
            .map((path) => path.trim())
            .filter(Boolean)
            .map((path) => resolve(path))
        )
      ];
const encodedScopes = scopes === null ? null : scopes.map(encodeCwd);

const now = Date.now();
const cutoff = now - hours * 3600 * 1000;

const sessions = listTranscripts(PROJECTS_DIR)
  .filter((path) => !basename(path).startsWith('agent-')) // subagent sidechain transcripts
  .filter((path) => encodedScopes === null || encodedScopes.some((encoded) => inScope(basename(dirname(path)), encoded)))
  .map((path) => ({ path, mtimeMs: statSync(path).mtimeMs }))
  .filter(({ mtimeMs }) => mtimeMs >= cutoff)
  .map(({ path, mtimeMs }) => buildInfo(path, mtimeMs, now))
  .filter((info) => info.user_turns > 0) // hook-only / empty shells, nothing to resume
  .sort((first, second) => first.minutes_ago - second.minutes_ago);

process.stdout.write(
  JSON.stringify(
    {
      generated_at: toLocalIsoMinutes(new Date(now)),
      scope: scopes?.join(',') ?? 'all',
      window_hours: hours,
      count: sessions.length,
      sessions
    },
    null,
    1
  )
);
