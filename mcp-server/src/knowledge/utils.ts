import { FILES, FOLDERS, KNOWLEDGE } from '@/config';
import type { TranscriptTurn } from '@/shared/types';
import { todayDate } from '@/shared/utils';
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

export async function wikiArticleExists(link: string): Promise<boolean> {
  try {
    await stat(resolve(FOLDERS.KNOWLEDGE, link + '.md'));
    return true;
  } catch {
    return false;
  }
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
    const today = todayDate();
    const entries = await readdir(FOLDERS.SESSIONS);
    return entries
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && !f.startsWith(today))
      .map((f) => resolve(FOLDERS.SESSIONS, f))
      .sort();
  } catch {
    return [];
  }
}

// ── Transcript extraction ────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Flatten a Claude Code content block (string or structured array) into text. */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
    } else if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

/**
 * Read a Claude Code JSONL transcript and return only the user/assistant text
 * turns. Tool results, non-text blocks, system-reminders, and slash-command
 * artefacts are filtered out.
 */
export function readTranscript(transcriptPath: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  const fileContent = readFileSync(transcriptPath, 'utf-8');
  for (const line of fileContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isRecord(entry)) continue;
    const msg = isRecord(entry.message) ? entry.message : entry;
    const role = typeof msg.role === 'string' ? msg.role : undefined;
    if (role !== 'user' && role !== 'assistant') continue;

    const text = contentToText(msg.content).trim();
    if (!text) continue;
    if (text.startsWith('<system-reminder>') || text.startsWith('<command-name>')) continue;

    turns.push({ role, text });
  }
  return turns;
}

/**
 * Format recent transcript turns as a markdown-ish context block for the
 * session log. Per-turn cap stops one oversized turn from devouring the
 * budget; total cap caps cumulative size. Walks turn boundaries explicitly
 * so headers aren't sliced through.
 */
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
    .replace(/\bgh[pousa]_[A-Za-z0-9]{30,}/g, '<REDACTED:GITHUB_TOKEN>');

  return out;
}

export function extractConversationContext(
  transcriptPath: string,
  maxTurns: number = KNOWLEDGE.MAX_TRANSCRIPT_TURNS,
  maxChars: number = KNOWLEDGE.MAX_TRANSCRIPT_CHARS,
  maxTurnChars: number = KNOWLEDGE.MAX_TURN_CHARS
): { context: string; turnCount: number } {
  const recent = readTranscript(transcriptPath).slice(-maxTurns);

  const formatted = recent.map((t) => {
    const role = t.role === 'user' ? 'User' : 'Assistant';
    const text =
      t.text.length > maxTurnChars
        ? `${t.text.slice(0, maxTurnChars)}\n[… ${t.text.length - maxTurnChars} chars truncated]`
        : t.text;
    return `**${role}:** ${text}\n`;
  });

  if (formatted.length === 0) return { context: '', turnCount: 0 };

  const kept: string[] = [formatted[formatted.length - 1]];
  let total = kept[0].length;
  for (let i = formatted.length - 2; i >= 0; i--) {
    if (total + formatted[i].length > maxChars) break;
    kept.unshift(formatted[i]);
    total += formatted[i].length;
  }

  return { context: redactSecrets(kept.join('\n')), turnCount: recent.length };
}

