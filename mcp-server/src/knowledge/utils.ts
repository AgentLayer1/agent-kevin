import { FILES, FOLDERS } from '@/config';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

// ── Hashing ──────────────────────────────────────────────────────────

export const hashBuffer = (buf: Buffer | Uint8Array | string): string =>
  createHash('sha256').update(buf).digest('hex').slice(0, 16);

// ── Frontmatter helpers ──────────────────────────────────────────────

const FRONTMATTER_BLOCK_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Strip a leading YAML frontmatter block. Returns content unchanged if none. */
export const stripFrontmatter = (content: string): string => {
  const match = content.match(FRONTMATTER_BLOCK_RE);
  return match ? content.slice(match[0].length) : content;
};

/** Split a leading YAML frontmatter block from the body. */
export const splitFrontmatter = (content: string): { frontmatter: string; body: string } => {
  const match = content.match(FRONTMATTER_BLOCK_RE);
  if (!match) return { frontmatter: '', body: content };
  return { frontmatter: match[0], body: content.slice(match[0].length) };
};

// ── Text helpers ─────────────────────────────────────────────────────

/**
 * Replace every `{{key}}` placeholder in `template` with `vars[key]`.
 * Unknown placeholders are left intact so they're visible in output for debugging.
 * Single-pass: substituted values containing `{{...}}` are NOT re-expanded, which
 * keeps this safe for injecting arbitrary file content.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}

/**
 * Load a prompt-template markdown file that sits next to the calling script.
 * Pass `import.meta.url` from the script and the template filename.
 * Fails fast at module init if the file is missing.
 */
export function loadScriptTemplate(metaUrl: string, filename: string): string {
  return readFileSync(resolve(dirname(fileURLToPath(metaUrl)), filename), 'utf-8');
}

export function extractWikilinks(content: string): string[] {
  // CommonMark backtick-run matching: an opener of N backticks must be closed
  // by a run of exactly N backticks (lookbehind/ahead enforce no-adjacent-tick).
  const stripped = content.replace(/(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, '');
  // Strip `|alias` and `#anchor` so consumers (existence checks, backlink
  // resolution) operate on the target path only.
  return [...stripped.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].split(/[|#]/)[0]);
}

/**
 * Resolvable task identifiers — full slugs (`en-027-provider-error-...`) plus
 * bare IDs (`en-027`) — collected from every `projects/<proj>/tasks/` directory.
 * Not cached: the MCP server is long-lived and tasks are created mid-session, so
 * `checkBrokenLinks` loads this once per run and passes it down.
 */
export async function loadTaskTargets(): Promise<Set<string>> {
  const targets = new Set<string>();
  let projectDirs: string[];
  try {
    projectDirs = await readdir(FOLDERS.PROJECTS);
  } catch {
    return targets; // No projects directory — task links simply won't resolve.
  }
  await Promise.all(
    projectDirs.map(async (projectDir) => {
      let files: string[];
      try {
        files = await readdir(resolve(FOLDERS.PROJECTS, projectDir, 'tasks'));
      } catch {
        return; // Not a project dir, or it has no tasks/ subdir.
      }
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const slug = file.replace(/\.md$/, '');
        targets.add(slug);
        const bareId = slug.match(/^([a-z]{2}-\d{3})/i)?.[1];
        if (bareId) targets.add(bareId.toLowerCase());
      }
    })
  );
  return targets;
}

/**
 * A wikilink target is valid if it resolves to any of:
 *  - a knowledge article by direct path (`concepts/foo`, `memory/2026-...`)
 *  - a bare slug in a known knowledge subdir (`service-decomposition` → concepts/)
 *  - a HOME-root doc (`USER`, `SOUL`, `IDENTITY`, `CLAUDE`; leading slash + `.md` tolerated)
 *  - a task file under `projects/<proj>/tasks/` by full slug or bare ID (`en-027`)
 *
 * The wiki spans more than `knowledge/` — Obsidian's vault root is HOME, so links
 * legitimately cross into HOME-root docs and the task tree. Resolving only within
 * `knowledge/` produced false "broken link" errors that fought with Obsidian's
 * `alwaysUpdateLinks` normalisation.
 *
 * `taskTargets` is loaded once per lint run and passed in to avoid re-scanning the
 * project tree per link; standalone callers can omit it for a fresh one-off scan.
 */
export async function wikiArticleExists(link: string, taskTargets?: Set<string>): Promise<boolean> {
  const normalized = link.replace(/^\/+/, '').replace(/\.md$/i, '');
  if (!normalized) return false;

  const fileCandidates = [
    resolve(FOLDERS.KNOWLEDGE, normalized + '.md'),
    resolve(FOLDERS.CONCEPTS, normalized + '.md'),
    resolve(FOLDERS.USER_KNOWLEDGE, normalized + '.md'),
    resolve(FOLDERS.MEMORY, normalized + '.md'),
    resolve(FOLDERS.HOME, normalized + '.md')
  ];
  for (const candidate of fileCandidates) {
    const found = await stat(candidate)
      .then(() => true)
      .catch(() => false);
    if (found) return true;
  }

  const tasks = taskTargets ?? (await loadTaskTargets());
  return tasks.has(normalized) || tasks.has(normalized.toLowerCase());
}

// ── Wiki reading ─────────────────────────────────────────────────────

export async function readWikiIndex(): Promise<string> {
  try {
    return await readFile(FILES.KNOWLEDGE, 'utf-8');
  } catch {
    return '(empty - no articles compiled yet)';
  }
}

export async function listWikiArticles(): Promise<string[]> {
  async function scanDir(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const nested = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = resolve(dir, entry.name);
          if (entry.isDirectory()) return scanDir(fullPath);
          if (entry.name.endsWith('.md')) return [fullPath];
          return [];
        })
      );
      return nested.flat();
    } catch {
      return [];
    }
  }
  const buckets = await Promise.all(
    ['user', 'concepts', 'memory'].map((cat) => scanDir(resolve(FOLDERS.KNOWLEDGE, cat)))
  );
  return buckets.flat();
}

export async function readAllWikiContent(): Promise<Map<string, string>> {
  const articles = await listWikiArticles();
  const pairs = await Promise.all(
    articles.map(async (path) => [relative(FOLDERS.KNOWLEDGE, path), await readFile(path, 'utf-8')] as const)
  );
  return new Map(pairs);
}

// ── Raw session listing ──────────────────────────────────────────────

export async function listRawFiles(): Promise<string[]> {
  try {
    const entries = await readdir(FOLDERS.SESSIONS);
    return entries
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map((f) => resolve(FOLDERS.SESSIONS, f))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Redact secrets from text before it goes anywhere persistent. Two passes:
 *
 * 1. **Exact-match redaction** — pull every value from `<HOME>/.claude/settings.local.json`
 *    `env` block and replace literal occurrences in the text with `<REDACTED:KEY_NAME>`.
 *    This is the deterministic path — anything actually saved as a key gets scrubbed.
 *
 * 2. **Heuristic prefix redaction** — catch keys the user typed but hasn't saved yet
 *    (e.g. during a configure-skills walk where they pasted a value just before the
 *    session ended). Matches well-known prefixes: `sk-…`, `pplx-…`, `AIza…`, generic
 *    `<KEY>=value` env-var assignments. Limits length to avoid eating prose.
 *
 * Skipping values shorter than 12 chars to avoid scrubbing common short strings
 * that happen to match a key's value. Real API keys are long.
 *
 * 3. **Base64 blob redaction** — pasted PNG/JPEG/PDF payloads make session logs
 *    unreadable and choke Obsidian's indexer. Catches `data:<mime>;base64,XXXX`
 *    data URIs and standalone runs of ≥200 base64-alphabet characters. The
 *    200-char floor is well above hex hashes (64), JWTs (segments are
 *    dot-separated and caught by Pass 2), and URL-safe IDs, so prose and
 *    identifiers pass through untouched.
 */
export function redactSecrets(text: string): string {
  let out = text;

  // Pass 1: exact-match scrub from settings.local.json
  const settingsPath = resolve(FOLDERS.HOME, '.claude', 'settings.local.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { env?: Record<string, string> };
      for (const [name, value] of Object.entries(settings.env ?? {})) {
        if (typeof value !== 'string' || value.length < 12) continue;
        // Escape regex special chars in the value before substituting.
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(escaped, 'g'), `<REDACTED:${name}>`);
      }
    } catch {
      // malformed settings.local.json — fall through to prefix pass
    }
  }

  // Pass 2: prefix heuristics for common API key formats.
  // Order matters — the more specific patterns must run before the generic
  // `sk-` catch-all, otherwise Anthropic keys get tagged as SK_KEY.
  out = out
    // Anthropic: sk-ant-...
    .replace(/\bsk-ant-[A-Za-z0-9_-]{20,}/g, '<REDACTED:ANTHROPIC_KEY>')
    // OpenAI-style: sk-..., sk-proj-..., sk-svcacct-...
    .replace(/\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, '<REDACTED:SK_KEY>')
    // Perplexity: pplx-...
    .replace(/\bpplx-[A-Za-z0-9]{20,}/g, '<REDACTED:PPLX_KEY>')
    // Google API: AIza...
    .replace(/\bAIza[A-Za-z0-9_-]{30,}/g, '<REDACTED:GOOGLE_API_KEY>')
    // GitHub PAT/OAuth/server/user/app: ghp_, gho_, ghs_, ghu_, gha_
    .replace(/\bgh[pousa]_[A-Za-z0-9]{30,}/g, '<REDACTED:GITHUB_TOKEN>')
    // Connection strings with embedded credentials: scheme://user:pass@host
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@\S+/gi, '<REDACTED:DB_URL>')
    // Generic URL-query / form-param secrets — catches any provider whose key
    // doesn't have a recognisable prefix (e.g. SerpAPI's 64-char hex passed as
    // `?api_key=...`). Defense-in-depth behind Pass 1's exact-match scrub.
    .replace(
      /\b(api[_-]?key|access[_-]?token|token|authorization|bearer)([=:\s]+)([A-Za-z0-9_-]{20,})/gi,
      '$1$2<REDACTED:VALUE>'
    );

  // Pass 3: base64 blobs. Data URIs first so the mime prefix survives.
  out = out
    .replace(/(data:[\w.+-]+\/[\w.+-]+;base64,)[A-Za-z0-9+/]{40,}={0,2}/g, '$1<REDACTED:BASE64>')
    .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, '<REDACTED:BASE64>');

  return out;
}
