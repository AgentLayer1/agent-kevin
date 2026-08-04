import { agentHomePath, env, loadedSecretKeyNames } from '@/shared/env';
import { expandTilde } from '@/shared/paths';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PLUGIN_ROOT = env('KEVIN_PLUGIN_ROOT') ?? resolve(import.meta.dir, '..', '..');

const fromEnv = (key: string, fallback: string) => expandTilde(env(key) || fallback);

// Path roots resolve LIVE on every access, never frozen at import — matching what
// `@/shared/env` already does for the secrets file. Freezing them made every path in the
// server depend on which module happened to import config FIRST: anything that set
// `KEVIN_HOME` afterwards (a hook, the CLI, a test) silently lost, and a test suite could
// be pointed at the operator's real brain by an unrelated import elsewhere.
//
// `agentHomePath()` is `KEVIN_HOME` when set, else the nearest home above cwd carrying this
// agent's data dir, else cwd (pre-init). The walk-up means a server or hook launched inside a
// code repo still resolves the operator's home instead of anchoring `.kevin/` state and
// session captures to the repo. It caches its walk into `KEVIN_HOME`, so repeat calls are an
// env read plus a `resolve`.
const homeRoot = (): string => agentHomePath();
const knowledgeRoot = (): string => fromEnv('KEVIN_KNOWLEDGE', resolve(homeRoot(), 'knowledge'));
const dataRoot = (): string => resolve(homeRoot(), '.kevin');
const secretsRoot = (): string => resolve(dataRoot(), 'secrets');

// Env values + secret loading live in `@/shared/env` (a config-free module — see
// its header for why it's kept apart).
// Importing it self-loads `.kevin/secrets/.env`; `env()` below reads through it.

export interface SecretEntry {
  name: string;
  present: boolean;
}

/**
 * Presence-only inventory of the secret store, for the dashboard. Env keys come
 * from what was loaded at boot (names only — values never leave config); the
 * Google OAuth files are checked on disk so a mid-session auth shows up without
 * a restart. Google rows appear only once the auth flow has created the dir, so
 * homes that never connect Google aren't shown empty rows.
 */
export function listSecretEntries(): SecretEntry[] {
  const googleDir = resolve(secretsRoot(), 'google');
  const google = existsSync(googleDir)
    ? [
        { name: 'google/oauth-client', present: existsSync(resolve(googleDir, 'google-oauth-client.json')) },
        { name: 'google/tokens', present: existsSync(resolve(googleDir, 'google-tokens.json')) }
      ]
    : [];
  return [...loadedSecretKeyNames().map((name) => ({ name, present: true })), ...google];
}

export const TIMEZONE = env('KEVIN_TIMEZONE') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** The operator's home-base IANA timezone, set via `KEVIN_HOME_TIMEZONE` in
 *  `.claude/settings.local.json` `env`. When set and different from `TIMEZONE`,
 *  the SessionStart context flags the operator as traveling. */
export const HOME_TIMEZONE = env('KEVIN_HOME_TIMEZONE') || '';

/** URL template the dashboard uses to open markdown files in a native app.
 *  `{path}` is replaced with the URL-encoded absolute path. Set via the
 *  `MARKDOWN_URL` env var (e.g. in `.claude/settings.local.json` `env`);
 *  defaults to Obsidian. */
export const MARKDOWN_URL = env('MARKDOWN_URL') || 'obsidian://open?path={path}&paneType=tab';

/** Plugin name used to detect "is this plugin enabled in cwd?" in cross-agent
 * defer logic. Mirrors `.claude-plugin/plugin.json` `name`. Kept here so the
 * harness-agnostic capture core stays one substitution away from a fork. */
export const PLUGIN_NAME = 'agent-kevin';

/** Plugin version from `.claude-plugin/plugin.json`, read once at module load.
 *  Falls back to `0.0.0` if the manifest is missing or unparseable. */
export const PLUGIN_VERSION = ((): string => {
  try {
    const manifest = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf-8'));
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/**
 * Filesystem layout. Plugin-relative entries are plain values (fixed for the process);
 * everything home-relative is a getter, so each read reflects the current `KEVIN_HOME`.
 */
export const FOLDERS = {
  ROOT: PLUGIN_ROOT,
  TEMPLATES: resolve(PLUGIN_ROOT, 'templates'),
  get HOME() {
    return homeRoot();
  },
  get DATA() {
    return dataRoot();
  },
  get CONFIG() {
    return resolve(dataRoot(), 'config');
  },
  /** Deny-gated secrets dir (0700). */
  get SECRETS() {
    return secretsRoot();
  },
  get LOGS() {
    return resolve(dataRoot(), 'logs');
  },
  get KNOWLEDGE() {
    return knowledgeRoot();
  },
  get USER_KNOWLEDGE() {
    return resolve(knowledgeRoot(), 'user');
  },
  get MEMORY() {
    return resolve(knowledgeRoot(), 'memory');
  },
  get CONCEPTS() {
    return resolve(knowledgeRoot(), 'concepts');
  },
  get SESSIONS() {
    return resolve(knowledgeRoot(), 'raw', 'sessions');
  },
  get USER_RAW() {
    return resolve(knowledgeRoot(), 'raw', 'user');
  },
  get INBOX_RAW() {
    return resolve(knowledgeRoot(), 'raw', 'inbox');
  },
  get INBOX_ARCHIVE() {
    return resolve(knowledgeRoot(), 'raw', 'archive', 'inbox');
  },
  get PROJECTS() {
    return fromEnv('KEVIN_PROJECTS', resolve(homeRoot(), 'projects'));
  },
  get REPORTS() {
    return fromEnv('KEVIN_REPORTS', resolve(homeRoot(), 'reports'));
  }
} as const;

/** Browser/Playwright settings shared by the `browser-flows` skill scripts (and any future
 * capture-tool consumers). Single source so paths + tunables don't drift. */
export const BROWSER = {
  get STATE_DIR() {
    return resolve(dataRoot(), 'browser');
  },
  get CAPTURES_DIR() {
    return resolve(FOLDERS.REPORTS, 'captures');
  },
  INTERACTIVE_ARGS: ['--window-size=1280,900', '--window-position=120,80'] as readonly string[],
  LOGIN_WAIT_MS: 300_000
} as const;

/** Extra git repos surfaced in the SessionStart context alongside the knowledge
 * directory. Configure via `KEVIN_GIT_REPOS` env var (comma-separated paths,
 * `~` expanded). The basename of each path is used as its section label. */
export const EXTRA_GIT_REPOS: readonly string[] = (env('KEVIN_GIT_REPOS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(expandTilde);

/** Well-known files. Getters, for the same reason as FOLDERS. */
export const FILES = {
  get CONFIG() {
    return resolve(FOLDERS.CONFIG, 'config.json');
  },
  /** Static Agent OS dashboard — regenerated by the `dashboard` tool / sync. */
  get DASHBOARD() {
    return resolve(homeRoot(), 'dashboard.html');
  },
  /** HOME-root strategic roadmap (roadmap skill output) — when present, the
   *  dashboard links it as the first surface. */
  get ROADMAP() {
    return resolve(homeRoot(), 'roadmap.html');
  },
  get KNOWLEDGE_STATE() {
    return resolve(dataRoot(), 'knowledge.json');
  },
  /** HOME template baseline — which plugin version this home's scaffolded files
   *  (CLAUDE.md, SOUL.md, settings, rules…) were last reconciled to. Written by
   *  `/init` (fresh homes) and `/agent-kevin:upgrade` (thereafter); read by the
   *  banner + dashboard to flag pending HOME migrations. See version.ts. */
  get VERSION() {
    return resolve(dataRoot(), 'version.json');
  },
  get REPORTS_INDEX() {
    return resolve(FOLDERS.REPORTS, 'index.md');
  },
  get SOUL() {
    return resolve(homeRoot(), 'SOUL.md');
  },
  get IDENTITY() {
    return resolve(homeRoot(), 'IDENTITY.md');
  },
  /** Kevin's operating manual. Lives at <HOME>/CLAUDE.md by default. If a
   *  CLAUDE.md already existed when /init ran (plugin installed into an
   *  existing project), init writes to CLAUDE_LOCAL instead and leaves the
   *  user's CLAUDE.md untouched. */
  get CLAUDE() {
    return resolve(homeRoot(), 'CLAUDE.md');
  },
  get CLAUDE_LOCAL() {
    return resolve(homeRoot(), 'CLAUDE.local.md');
  },
  get USER() {
    return resolve(homeRoot(), 'USER.md');
  },
  get MEMORY() {
    return resolve(FOLDERS.MEMORY, 'index.md');
  },
  get KNOWLEDGE() {
    return resolve(FOLDERS.KNOWLEDGE, 'index.md');
  },
  get FEEDBACK() {
    return resolve(FOLDERS.USER_RAW, 'feedback.md');
  },
  /** Session catalog keyed by sessionId — capture cursor + cross-day resume
   *  tracking. Authoritative for "how far have we captured session X"; itself
   *  reconstructable from day-file block headers (see session-index.ts). */
  get SESSION_INDEX() {
    return resolve(FOLDERS.SESSIONS, 'index.json');
  }
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
