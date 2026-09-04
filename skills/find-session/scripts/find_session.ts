#!/usr/bin/env bun
/**
 * Find Claude Code sessions whose transcripts contain the given search terms.
 *
 * Scans ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl for substring hits,
 * then parses only the matching transcripts to extract the signals that separate
 * "worked on it" from "mentioned it": distinct cwds (worktree roaming), title,
 * per-term hit counts, and whether the operator's own prompts contain a term.
 * Read-only, no network. Prints JSON sorted by total hits, then recency.
 *
 * Usage: bun find_session.ts [--scope <path>[,<path>...]|all] [--hours <n>] <term> [term ...]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const USER_SNIPPET = 300;
const MAX_RESULTS = 12;

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

interface MatchInfo {
  session_id: string;
  file: string;
  title: string | null;
  started: string | null;
  last_timestamp: string | null;
  cwds: string[];
  git_branches: string[];
  first_user_msg: string | null;
  slash_commands: string[];
  user_turns: number;
  hits: Record<string, number>;
  total_hits: number;
  terms_in_user_prompts: string[];
}

/** Parse `--key value` and `--key=value` flags; everything else is a search term. */
const parseArgs = (argv: readonly string[]): { flags: Map<string, string>; terms: string[] } => {
  const flags = new Map<string, string>();
  const terms: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      terms.push(...token.split(',').map((part) => part.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    const eq = token.indexOf('=');
    if (eq !== -1) {
      flags.set(token.slice(2, eq), token.slice(eq + 1));
      index += 1;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(token.slice(2), next);
      index += 2;
    } else {
      flags.set(token.slice(2), '');
      index += 1;
    }
  }
  return { flags, terms };
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

const countOccurrences = (haystack: string, needle: string): number => {
  let count = 0;
  let position = haystack.indexOf(needle);
  while (position !== -1) {
    count += 1;
    position = haystack.indexOf(needle, position + needle.length);
  }
  return count;
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

const buildMatch = (path: string, raw: string, hits: Record<string, number>, loweredTerms: string[]): MatchInfo => {
  const records = parseRecords(raw);

  const customTitle = records.filter((record) => record.type === 'custom-title' && record.customTitle).at(-1)?.customTitle;
  const aiTitle = records.filter((record) => record.type === 'ai-title' && record.aiTitle).at(-1)?.aiTitle;

  const body = records.filter(
    (record) => record.type !== 'ai-title' && record.type !== 'custom-title' && !record.isSidechain
  );
  const timestamps = body.map((record) => record.timestamp).filter((ts): ts is string => Boolean(ts));

  const userRecords = body.filter((record) => record.type === 'user');
  const userMessages = userRecords.flatMap(userTexts);
  const loweredUserText = userMessages.join('\n').toLowerCase();

  // Slash-command-only sessions (a /sync, a /health-check) have zero "real" user
  // text but are still resumable — and often exactly what a search is after.
  const slashCommands = [
    ...new Set(
      userRecords
        .flatMap((record) => {
          const content = record.message?.content;
          const texts =
            typeof content === 'string'
              ? [content]
              : Array.isArray(content)
                ? content.map(blockText).filter((text): text is string => text !== null)
                : [];
          return texts
            .map((text) => /<command-name>([^<]+)<\/command-name>/.exec(text)?.[1])
            .filter((name): name is string => Boolean(name));
        })
    )
  ];

  return {
    session_id: basename(path).replace(/\.jsonl$/, ''),
    file: path,
    title: customTitle ?? aiTitle ?? null,
    started: timestamps[0] ?? null,
    last_timestamp: timestamps.at(-1) ?? null,
    cwds: [...new Set(body.map((record) => record.cwd).filter((cwd): cwd is string => Boolean(cwd)))],
    git_branches: [...new Set(body.map((record) => record.gitBranch).filter((branch): branch is string => Boolean(branch)))],
    first_user_msg: userMessages.length > 0 ? clip(userMessages[0], USER_SNIPPET) : null,
    slash_commands: slashCommands,
    user_turns: userMessages.length,
    hits,
    total_hits: Object.values(hits).reduce((sum, count) => sum + count, 0),
    terms_in_user_prompts: loweredTerms.filter((term) => loweredUserText.includes(term))
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

const { flags, terms } = parseArgs(process.argv.slice(2));
if (terms.length === 0) {
  process.stderr.write('usage: bun find_session.ts [--scope <paths>|all] [--hours <n>] <term> [term ...]\n');
  process.exit(2);
}
const loweredTerms = [...new Set(terms.map((term) => term.toLowerCase()))];

// Default roots mirror list_sessions.ts: cwd, the agent HOME, and the code tree, built
// in-process because a shell-expanded $PWD arrives POSIX-form under Git Bash on Windows.
const agentHome = process.env.KEVIN_HOME?.trim() || process.env.AGENT_HOME?.trim();
const codePath = process.env.KEVIN_CODE_PATH?.trim() || process.env.AGENT_CODE_PATH?.trim();
const defaultScope = [process.cwd(), agentHome, codePath && dirname(codePath)]
  .filter((path): path is string => Boolean(path))
  .join(',');
const scopeFlag = flags.get('scope');
const scopes =
  scopeFlag === 'all'
    ? null
    : [
        ...new Set(
          (scopeFlag || defaultScope)
            .split(',')
            .map((path) => path.trim())
            .filter(Boolean)
            .map((path) => resolve(path))
        )
      ];
const encodedScopes = scopes === null ? null : scopes.map(encodeCwd);

const hoursFlag = flags.get('hours');
const hours = hoursFlag !== undefined && !Number.isNaN(Number.parseFloat(hoursFlag)) ? Number.parseFloat(hoursFlag) : null;
const cutoffMs = hours === null ? null : Date.now() - hours * 3600 * 1000;

const matches = listTranscripts(PROJECTS_DIR)
  .filter((path) => !basename(path).startsWith('agent-')) // subagent sidechains aren't resumable
  .filter((path) => encodedScopes === null || encodedScopes.some((encoded) => inScope(basename(dirname(path)), encoded)))
  // mtime is never earlier than the last record, so it's a safe superset gate for --hours.
  .filter((path) => cutoffMs === null || statSync(path).mtimeMs >= cutoffMs)
  .flatMap((path) => {
    const raw = readFileSync(path, 'utf-8');
    const lowered = raw.toLowerCase();
    const hits = Object.fromEntries(
      loweredTerms.map((term) => [term, countOccurrences(lowered, term)] as const).filter(([, count]) => count > 0)
    );
    return Object.keys(hits).length > 0 ? [buildMatch(path, raw, hits, loweredTerms)] : [];
  })
  .filter((match) => match.user_turns > 0 || match.slash_commands.length > 0) // hook-only / empty shells
  .sort(
    (first, second) =>
      second.total_hits - first.total_hits ||
      (second.last_timestamp ?? '').localeCompare(first.last_timestamp ?? '')
  );

process.stdout.write(
  JSON.stringify(
    {
      terms: loweredTerms,
      scope: scopes?.join(',') ?? 'all',
      window_hours: hours,
      matched: matches.length,
      truncated: matches.length > MAX_RESULTS,
      sessions: matches.slice(0, MAX_RESULTS)
    },
    null,
    1
  )
);
