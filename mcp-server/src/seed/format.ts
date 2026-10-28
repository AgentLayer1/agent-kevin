/**
 * Seed bundle format (formatVersion 1) — the contract behind `seed_scan` /
 * `seed_export` / `seed_import` and the agentlayer.one/dev wizard.
 *
 * A seed bundle is a one-shot handoff: an operator exports their agent's
 * persona + diverged setup as a plain zip, and a teammate's fresh home imports
 * it with fork semantics — the recipient owns every file and diverges freely.
 * No provenance, no sync, no replicas (that's the shared-brain design, a
 * different feature). Identity IS the payload here.
 *
 * Bundle layout:
 *   <name>-seed.zip
 *   ├── manifest.json            (SeedManifest below)
 *   └── files/<home-relative>    (payload, e.g. files/IDENTITY.md)
 *
 * The format must accept a MINIMAL producer: a valid bundle can be just
 * manifest.json + IDENTITY.md + SOUL.md, generated client-side in a browser
 * with no source home (the website wizard). Every manifest field beyond
 * formatVersion/agentName/files is optional.
 *
 * What never travels, regardless of producer: secret VALUES, the data dir (`.state/`),
 * USER.md, knowledge/{user,memory,raw}, tasks, and session transcripts. The
 * operating manual travels only as curated sections under the `AGENTS.md`
 * path, which import APPENDS to the recipient's scaffolded manual (never
 * replaces — upgrades keep carrying it). Import refuses any path outside
 * ALLOWED_ROOTS — a hostile manifest cannot touch settings, secrets, or
 * anything else in the home.
 */
import { FOLDERS, MCP_PREFIX, PLUGIN_NAME } from '@/config';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Hash used for `SeedFileEntry.hash` — one definition for producer and consumer. */
export const sha256 = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export interface SeedFileEntry {
  /** Home-relative POSIX path (e.g. `knowledge/concepts/flywheel-model.md`). */
  path: string;
  /** `sha256:<hex>` of the payload bytes — verified on import. */
  hash: string;
  /** True when the content was authored during export (e.g. the manual overlay), not copied from disk. */
  generated?: boolean;
}

export const SEED_AUDIENCES = ['self', 'teammate'] as const;

/** Who the bundle is for: the operator's own second agent, or someone else. */
export type SeedAudience = (typeof SEED_AUDIENCES)[number];

export interface SeedManifest {
  formatVersion: 1;
  /** Display name the agent carries (IDENTITY.md is the authoritative file; this labels the bundle). */
  agentName: string;
  /** Absent on bundles from older producers and the website wizard; import treats that as `teammate`. */
  audience?: SeedAudience;
  /** ISO timestamp of the export. */
  createdAt: string;
  files: SeedFileEntry[];
  /** Permission entries to merge into the recipient's settings.json (reviewed at export). */
  permissions?: { allow?: string[]; ask?: string[]; deny?: string[] };
  /** Secret env key NAMES the setup needs — recipient fills values in `.state/secrets/.env`. */
  secretKeys?: string[];
  /** Non-secret env key NAMES planted empty in the recipient's settings.local.json `env` block. */
  settingsEnv?: string[];
  /** MCP server entries to merge into the recipient's `<HOME>/.mcp.json` (structure only — they reference env keys, never values). */
  mcpServers?: Record<string, unknown>;
}

/**
 * Home-relative roots a seed file may live under. Export includes and import
 * writes are both validated against this list — it is the structural privacy
 * gate and the import blast-radius limit in one.
 */
/** Bundle path of the operating-manual overlay (append-only on import). */
export const MANUAL_SEED_PATH = 'AGENTS.md';

export const ALLOWED_ROOTS = [
  'IDENTITY.md',
  'SOUL.md',
  // Append-only on import: the recipient's scaffolded manual is never replaced, and
  // upgrade's template reconciliation carries operator additions forward. Never
  // .claude/CLAUDE.md — that is the Claude Code bridge, not the manual.
  MANUAL_SEED_PATH,
  'roadmap.html',
  'knowledge/concepts/',
  'projects/',
  '.claude/skills/',
  '.claude/rules/',
  'assets/',
  'scripts/'
] as const;

/** Within `projects/`, only READMEs, roadmaps and queue profiles travel — never tasks (clean slate). */
const PROJECT_FILE_RE = /^projects\/[^/]+\/(README\.md|roadmap\.html|helpdesk\.md)$/;

/**
 * A browser flow keeps its credentials in its own `.env`; no root may carry one, in any case or
 * variant (`.ENV`, `.envrc`, `.env.local`). `.env.example` is a key template, as in `.gitignore`.
 */
export const isEnvFile = (path: string): boolean =>
  /(^|\/)\.env[^/]*$/i.test(path) && !/(^|\/)\.env\.example$/i.test(path);

/** The plugin's own flows; the browser_flows tool runs a home flow of the same name in their place. */
const builtinFlows = (): string[] => {
  const dir = resolve(FOLDERS.ROOT, 'skills', 'browser-flows', 'flows');
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
};

/**
 * Stands in for the source home's path inside carried MCP entries; import writes the
 * recipient's home in its place. Same token the configure-skills server template uses.
 */
export const HOME_PLACEHOLDER = '<HOME_DIR>';

/**
 * Validate one manifest/include path: relative, normalized, no traversal, and
 * inside an allowed root. Returns an error string, or null when valid.
 */
export const validateSeedPath = (path: string): string | null => {
  if (typeof path !== 'string') return `path must be a string: ${JSON.stringify(path)}`;
  if (path.includes('\\')) return `backslash in path (POSIX separators only): ${path}`;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return `absolute path not allowed: ${path}`;
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return `path traversal or empty segment: ${path}`;
  }
  const inRoot = ALLOWED_ROOTS.some((root) => (root.endsWith('/') ? path.startsWith(root) : path === root));
  if (!inRoot) return `outside allowed seed roots: ${path}`;
  if (isEnvFile(path)) return `credential file never travels: ${path}`;
  const flow = /^scripts\/browser\/([^/]+)\//.exec(path)?.[1];
  if (flow && builtinFlows().includes(flow)) {
    return `a bundled flow may not take a built-in flow's name, since it would run in its place: ${path}`;
  }
  if (path.startsWith('projects/') && !PROJECT_FILE_RE.test(path)) {
    return `only projects/<slug>/README.md, roadmap.html and helpdesk.md may travel (never tasks): ${path}`;
  }
  return null;
};

/**
 * Credential-shaped env key names. These never belong in a bundle's
 * `settingsEnv` (an empty placeholder there would invite putting a secret in
 * settings.local.json) — a credential the setup needs travels as a `secretKeys`
 * NAME instead, filled by the recipient in `.state/secrets/.env`.
 */
export const CREDENTIAL_KEY_RE = /(_TOKEN|_KEY|_SECRET|_PASSWORD|_CREDENTIALS?)($|_)/;

const mcp = (names: string[]): string[] => names.map((name) => `${MCP_PREFIX}${name}`);

/**
 * Grant classification for `seed_scan` — mirrors what `/init` pre-grants and
 * what each `configure-skills` pack walk adds. Keep in sync with
 * `skills/configure-skills/SKILL.md` §E and the init baseline; drift here only
 * mis-labels the interview, it never changes what a reviewed export carries.
 */
const CORE_GRANTS = new Set([
  ...mcp([
    'ping',
    'attention_write',
    'capture',
    'codex_setup',
    'compile_next',
    'compile_status',
    'compile_write',
    'dashboard',
    'home_history',
    'knowledge_lint',
    'links_rewrite',
    'memory_prune',
    'report_write',
    'run_upgrade',
    'seed_export',
    'seed_import',
    'seed_scan',
    'setup_worktree',
    'video_frames',
    'media_transcribe',
    'task_close',
    'task_create',
    'task_get',
    'task_query',
    'task_scan',
    'task_thread',
    'task_update'
  ]),
  'Bash(cat *)',
  'Bash(date)',
  'Bash(date *)',
  'Bash(echo *)',
  'Bash(find *)',
  'Bash(git config user.email)',
  'Bash(git config user.name)',
  'Bash(git diff *)',
  'Bash(git log *)',
  'Bash(git status)',
  'Bash(git status *)',
  'Bash(ls)',
  'Bash(ls *)',
  'Bash(mkdir -p *)',
  'Bash(readlink *)',
  'Bash(test *)'
]);

interface PackDef {
  grants: string[];
  /** Entries the pack's walk adds to `permissions.deny`, carried with the pack so its routing holds. */
  denies?: string[];
  /** Secret key names the pack's tools read from `.state/secrets/.env`. */
  secretKeys: string[];
  /** Non-secret keys the pack plants in settings.local.json `env`. */
  settingsEnv: string[];
}

export const PACKS: Record<string, PackDef> = {
  seo: {
    grants: mcp([
      'serpapi_search',
      'open_page_rank',
      'gsc_inspect',
      'gsc_query',
      'gsc_sites',
      'google_auth',
      'page_speed_audit',
      'page_speed_psi'
    ]),
    secretKeys: ['SERPAPI_KEY', 'OPENPAGERANK_API_KEY'],
    settingsEnv: ['GSC_SITE_URL']
  },
  browser: {
    grants: mcp([
      'web_search',
      'browser_screenshot',
      'browser_pdf',
      'browser_markdown',
      'browser_record',
      'browser_flows'
    ]),
    secretKeys: ['PERPLEXITY_API_KEY'],
    settingsEnv: []
  },
  database: {
    grants: mcp(['database_list', 'database_query', 'database_schema', 'database_fork']),
    // AGENT_DB_* connection names live in the deny-gated store and can't be enumerated —
    // the recipient defines their own via the Database pack walk.
    secretKeys: [],
    settingsEnv: []
  },
  github: {
    grants: mcp([
      'github_fast_forward',
      'github_pr_list',
      'github_pr_view',
      'github_pr_comments',
      'github_pr_diff',
      'github_pr_checks',
      'github_run_list',
      'github_run_view',
      'github_run_log',
      'github_issue_list',
      'github_issue_view',
      'github_sweep',
      'github_issue_create',
      'github_issue_comment',
      'github_issue_update',
      'github_pr_update',
      'github_comment_update'
    ]),
    denies: ['Bash(gh)', 'Bash(gh *)'],
    secretKeys: ['GITHUB_TOKEN'],
    settingsEnv: []
  },
  helpdesk: {
    grants: mcp(['helpdesk_connections', 'helpdesk_tickets', 'helpdesk_ticket', 'helpdesk_attachment', 'helpdesk_accounts', 'helpdesk_lookups', 'helpdesk_stats', 'helpdesk_note', 'helpdesk_assign']),
    secretKeys: ['SUPPORTCANDY_APP_PASSWORD', 'PYLON_API_TOKEN'],
    settingsEnv: ['SUPPORTCANDY_URL', 'SUPPORTCANDY_USERNAME']
  },
  appstore: {
    grants: mcp(['appstore_reviews']),
    secretKeys: [],
    settingsEnv: []
  }
};

export type GrantClass = 'core' | 'skill' | 'custom' | { pack: string };

/** Classify one permissions entry for the export interview. */
export const classifyGrant = (entry: string): GrantClass => {
  if (CORE_GRANTS.has(entry)) return 'core';
  if (entry.startsWith(`Skill(${PLUGIN_NAME}:`)) return 'skill';
  const pack = Object.entries(PACKS).find(([, def]) => def.grants.includes(entry));
  return pack ? { pack: pack[0] } : 'custom';
};
