import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const PLUGIN_ROOT = process.env.KEVIN_PLUGIN_ROOT ?? resolve(import.meta.dir, '..', '..');

const tildify = (p: string) => (p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p);
const fromEnv = (key: string, fallback: string) => tildify(process.env[key]?.trim() || fallback);

// Default to the current working directory — wherever the user launched
// claude is Kevin's home. Override via `KEVIN_HOME` env var if launching
// claude from outside the agent dir (e.g. from a project subdir).
const KEVIN_HOME = fromEnv('KEVIN_HOME', process.cwd());
const KNOWLEDGE_ROOT = fromEnv('KEVIN_KNOWLEDGE', resolve(KEVIN_HOME, 'knowledge'));
const DATA_ROOT = resolve(KEVIN_HOME, '.kevin');

export const TIMEZONE = process.env.KEVIN_TIMEZONE?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** Plugin name used to detect "is this plugin enabled in cwd?" in cross-agent
 * defer logic. Mirrors `.claude-plugin/plugin.json` `name`. Kept here so the
 * harness-agnostic capture core stays one substitution away from a fork. */
export const PLUGIN_NAME = 'agent-kevin';

export const FOLDERS = {
  ROOT: PLUGIN_ROOT,
  HOME: KEVIN_HOME,
  TEMPLATES: resolve(PLUGIN_ROOT, 'templates'),
  DATA: DATA_ROOT,
  CONFIG: resolve(DATA_ROOT, 'config'),
  LOGS: resolve(DATA_ROOT, 'logs'),
  KNOWLEDGE: KNOWLEDGE_ROOT,
  USER_KNOWLEDGE: resolve(KNOWLEDGE_ROOT, 'user'),
  MEMORY: resolve(KNOWLEDGE_ROOT, 'memory'),
  CONCEPTS: resolve(KNOWLEDGE_ROOT, 'concepts'),
  SESSIONS: resolve(KNOWLEDGE_ROOT, 'raw', 'sessions'),
  USER_RAW: resolve(KNOWLEDGE_ROOT, 'raw', 'user'),
  INBOX_RAW: resolve(KNOWLEDGE_ROOT, 'raw', 'inbox'),
  INBOX_ARCHIVE: resolve(KNOWLEDGE_ROOT, 'raw', 'archive', 'inbox'),
  PROJECTS: fromEnv('KEVIN_PROJECTS', resolve(KEVIN_HOME, 'projects')),
  REPORTS: fromEnv('KEVIN_REPORTS', resolve(KEVIN_HOME, 'reports'))
} as const;

/** Extra git repos surfaced in the SessionStart context alongside the knowledge
 * directory. Configure via `KEVIN_GIT_REPOS` env var (comma-separated paths,
 * `~` expanded). The basename of each path is used as its section label. */
export const EXTRA_GIT_REPOS: readonly string[] = (process.env.KEVIN_GIT_REPOS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(tildify);

export const FILES = {
  CONFIG: resolve(FOLDERS.CONFIG, 'config.json'),
  KNOWLEDGE_STATE: resolve(DATA_ROOT, 'knowledge.json'),
  REPORTS_INDEX: resolve(FOLDERS.REPORTS, 'index.md'),
  SOUL: resolve(KEVIN_HOME, 'SOUL.md'),
  IDENTITY: resolve(KEVIN_HOME, 'IDENTITY.md'),
  /** Kevin's operating manual. Lives at <HOME>/CLAUDE.md by default. If a
   *  CLAUDE.md already existed when /init ran (plugin installed into an
   *  existing project), init writes to CLAUDE_LOCAL instead and leaves the
   *  user's CLAUDE.md untouched. */
  CLAUDE: resolve(KEVIN_HOME, 'CLAUDE.md'),
  CLAUDE_LOCAL: resolve(KEVIN_HOME, 'CLAUDE.local.md'),
  USER: resolve(KEVIN_HOME, 'USER.md'),
  MEMORY: resolve(FOLDERS.MEMORY, 'index.md'),
  KNOWLEDGE: resolve(FOLDERS.KNOWLEDGE, 'index.md'),
  FEEDBACK: resolve(FOLDERS.USER_RAW, 'feedback.md'),
  /** Session catalog keyed by sessionId — capture cursor + cross-day resume
   *  tracking. Authoritative for "how far have we captured session X"; itself
   *  reconstructable from day-file block headers (see session-index.ts). */
  SESSION_INDEX: resolve(FOLDERS.SESSIONS, 'index.json')
} as const;

export const KNOWLEDGE = {
  MEMORY_PRUNE_DAYS: 14,
  MAX_TURN_CHARS: 10_000,
  MAX_TEXT_FILE_BYTES: 512 * 1024,
  /** Upstream ceiling on raw URL fetches before sanitization. HTML pages with
   *  inline scripts/styles routinely blow past MAX_TEXT_FILE_BYTES raw but
   *  shrink to a fraction once stripped, so the stored-content cap is checked
   *  post-sanitization; this larger guard just prevents runaway downloads. */
  MAX_URL_FETCH_BYTES: 5 * 1024 * 1024,
  MAX_CHUNK_BYTES: 300 * 1024,
  // Cap on the raw chunk inlined into each compile_next prompt. Observed MCP
  // tool-response cap is ~16K tokens / ~50KB chars. With ~20KB overhead
  // (CLAUDE.md ~8KB + USER.md ~2KB + wiki index ~5KB + template boilerplate
  // ~3KB), a 30KB chunk leaves margin under the cap.
  MAX_SESSION_LOG_CHUNK_BYTES: 30 * 1024,
  MAX_COMPILE_TURNS: 60,
  IGNORED_FILES: new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitkeep'])
} as const;

export const CONTEXT = {
  /** Hard cap on the per-session `additionalContext` payload (Claude Code's hook limit). */
  MAX_CHARS: 9_500,
  /** Tail of yesterday's session log to inject for continuity. */
  SESSION_TAIL_BYTES: 1_500,
  /** Today's section of `reports/index.md`, injected so Kevin sees what was already produced today. */
  REPORTS_BYTES: 1_000,
  /** Commits to surface in the recent-git-activity slice. */
  MAX_GIT_LOG_COMMITS: 15
} as const;

/** True once `/agent-kevin:init` has been run. Keyed on SOUL.md — that
 * filename is unique to Kevin (CLAUDE.md may pre-exist in projects that
 * the plugin gets installed into, so it's not a safe marker). */
export function isInitialized(): boolean {
  return existsSync(FILES.SOUL);
}
