/**
 * Seed bundle format (formatVersion 1) — the contract behind `seed_scan` /
 * `seed_export` / `seed_import` and the dev.agentlayer.one wizard.
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
 * What never travels, regardless of producer: secret VALUES, `.kevin/` state,
 * USER.md, knowledge/{user,memory,raw}, tasks, session transcripts, and the
 * scaffolded CLAUDE.md (curated sections travel as CLAUDE.local.md so the
 * recipient stays on the upgrade path). Import refuses any path outside
 * ALLOWED_ROOTS — a hostile manifest cannot touch settings, secrets, or
 * anything else in the home.
 */
import { PLUGIN_NAME } from '@/config';
import { createHash } from 'node:crypto';

/** Hash used for `SeedFileEntry.hash` — one definition for producer and consumer. */
export const sha256 = (bytes: Buffer): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export interface SeedFileEntry {
  /** Home-relative POSIX path (e.g. `knowledge/concepts/flywheel-model.md`). */
  path: string;
  /** `sha256:<hex>` of the payload bytes — verified on import. */
  hash: string;
  /** True when the content was authored during export (e.g. the CLAUDE overlay), not copied from disk. */
  generated?: boolean;
}

export interface SeedManifest {
  formatVersion: 1;
  /** Display name the agent carries (IDENTITY.md is the authoritative file; this labels the bundle). */
  agentName: string;
  /** ISO timestamp of the export. */
  createdAt: string;
  files: SeedFileEntry[];
  /** Permission entries to merge into the recipient's settings.json (reviewed at export). */
  permissions?: { allow?: string[]; ask?: string[] };
  /** Secret env key NAMES the setup needs — recipient fills values in `.kevin/secrets/.env`. */
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
export const ALLOWED_ROOTS = [
  'IDENTITY.md',
  'SOUL.md',
  'CLAUDE.local.md',
  'roadmap.html',
  'knowledge/concepts/',
  'projects/',
  '.claude/skills/',
  '.claude/rules/',
  '.claude/assets/'
] as const;

/** Within `projects/`, only READMEs and roadmaps travel — never tasks (clean slate). */
const PROJECT_FILE_RE = /^projects\/[^/]+\/(README\.md|roadmap\.html)$/;

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
  if (path.startsWith('projects/') && !PROJECT_FILE_RE.test(path)) {
    return `only projects/<slug>/README.md and roadmap.html may travel (never tasks): ${path}`;
  }
  return null;
};

/**
 * Credential-shaped env key names. These never belong in a bundle's
 * `settingsEnv` (an empty placeholder there would invite putting a secret in
 * settings.local.json) — a credential the setup needs travels as a `secretKeys`
 * NAME instead, filled by the recipient in `.kevin/secrets/.env`.
 */
export const CREDENTIAL_KEY_RE = /(_TOKEN|_KEY|_SECRET|_PASSWORD|_CREDENTIALS?)($|_)/;

const MCP_PREFIX = `mcp__plugin_${PLUGIN_NAME}_kevin__`;

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
    'capture',
    'compile_next',
    'compile_status',
    'compile_write',
    'dashboard',
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
  /** Secret key names the pack's tools read from `.kevin/secrets/.env`. */
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
      'github_issue_view'
    ]),
    secretKeys: ['GITHUB_TOKEN'],
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
