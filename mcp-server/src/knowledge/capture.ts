/**
 * Universal capture — write any input (text, dropped file, fetched URL) into
 * Kevin's raw tree for the next knowledge-compile to absorb.
 *
 * Two destinations, one entry surface:
 *   - `kind: 'inbox'` (default) — timestamped doc in `raw/inbox/`, compiled
 *     into concepts on the next compile run.
 *   - `kind: 'feedback'` — appends an entry to `raw/user/feedback.md`, the
 *     append-only operator-meta log compiled into memory/index.md → Learnings.
 *
 * Local-only, secret-redacted, atomic write, content-hash deduped. The
 * compile lifecycle is unchanged — capture is just a writer.
 */
import { FILES, FOLDERS, KNOWLEDGE } from '@/config';
import { hashBuffer, redactSecrets, splitFrontmatter } from '@/knowledge/utils';
import { nowISO, nowTimeCompact, todayDate } from '@/shared/date';
import { htmlToMarkdown, renderExtracted } from '@/shared/html-to-markdown';
import { slugify } from '@/tasks/mutate';
import { existsSync, statSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';

export type CaptureKind = 'inbox' | 'feedback';

export interface CaptureOpts {
  text?: string;
  file?: string;
  url?: string;
  kind?: CaptureKind;
  title?: string;
  label?: string;
}

export interface CaptureResult {
  ok: true;
  kind: CaptureKind;
  path: string;
  relPath: string;
  bytes: number;
  duplicate: boolean;
}

async function fetchUrl(url: string): Promise<{ content: string; sourceHint: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; kevin-capture/1.0)',
        Accept: 'text/html,text/markdown,text/plain;q=0.9,*/*;q=0.5'
      },
      redirect: 'follow'
    });
  } catch (err) {
    throw new Error(`Fetch failed: ${url} — ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Fetch ${url} → HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') ?? '';
  const raw = await res.text();
  if (raw.length > KNOWLEDGE.MAX_URL_FETCH_BYTES) {
    throw new Error(
      `Response too large (${raw.length} > ${KNOWLEDGE.MAX_URL_FETCH_BYTES} bytes): ${url}`
    );
  }
  const isHtml = /html/i.test(contentType);
  const content = isHtml ? renderExtracted(await htmlToMarkdown(raw)) : raw;
  if (content.length > KNOWLEDGE.MAX_TEXT_FILE_BYTES) {
    throw new Error(
      `Sanitized content too large (${content.length} > ${KNOWLEDGE.MAX_TEXT_FILE_BYTES} bytes): ${url}`
    );
  }
  return { content, sourceHint: `url:${url}` };
}

async function resolveContent(opts: CaptureOpts): Promise<{ content: string; sourceHint: string }> {
  if (opts.text && opts.text.trim()) {
    return { content: opts.text, sourceHint: 'text' };
  }
  if (opts.url) {
    return fetchUrl(opts.url);
  }
  if (opts.file) {
    const abs = resolve(opts.file);
    if (!existsSync(abs)) throw new Error(`File not found: ${opts.file}`);
    const stat = statSync(abs);
    if (stat.size > KNOWLEDGE.MAX_TEXT_FILE_BYTES) {
      throw new Error(`File too large (${stat.size} > ${KNOWLEDGE.MAX_TEXT_FILE_BYTES} bytes): ${opts.file}`);
    }
    const content = await readFile(abs, 'utf-8');
    return { content, sourceHint: `file:${basename(abs)}` };
  }
  throw new Error('No content — provide text, url, or file');
}

function deriveSlug(content: string, title?: string): string {
  if (title && title.trim()) {
    const fromTitle = slugify(title);
    if (fromTitle) return fromTitle;
  }
  const firstLine = content.trim().split('\n')[0];
  return slugify(firstLine) || 'capture';
}

function buildFrontmatter(opts: CaptureOpts, sourceHint: string): string {
  const lines = ['---', `captured: ${nowISO()}`, `source: ${sourceHint}`];
  if (opts.title) lines.push(`title: ${JSON.stringify(opts.title)}`);
  if (opts.label) lines.push(`label: ${JSON.stringify(opts.label)}`);
  lines.push('---', '');
  return lines.join('\n');
}

function homeRelative(abs: string): string {
  return relative(FOLDERS.HOME, abs);
}

async function findDuplicate(contentHash: string): Promise<string | null> {
  for (const dir of [FOLDERS.INBOX_RAW, FOLDERS.INBOX_ARCHIVE]) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const abs = resolve(dir, name);
      const buf = await readFile(abs, 'utf-8');
      const { body } = splitFrontmatter(buf);
      if (hashBuffer(body) === contentHash) return abs;
    }
  }
  return null;
}

async function captureToInbox(opts: CaptureOpts, content: string, sourceHint: string): Promise<CaptureResult> {
  const redacted = redactSecrets(content);
  const contentBody = redacted + (redacted.endsWith('\n') ? '' : '\n');

  // Dedupe on the redacted CONTENT (post-frontmatter) so re-captures of
  // identical input short-circuit regardless of capture timestamp or attached
  // title/label. findDuplicate strips frontmatter from existing files for the
  // same canonical comparison.
  const contentHash = hashBuffer(contentBody);
  const existing = await findDuplicate(contentHash);
  if (existing) {
    const buf = await readFile(existing);
    return {
      ok: true,
      kind: 'inbox',
      path: existing,
      relPath: homeRelative(existing),
      bytes: buf.length,
      duplicate: true
    };
  }

  await mkdir(FOLDERS.INBOX_RAW, { recursive: true });
  const ts = `${todayDate()}-${nowTimeCompact()}`;
  const slug = deriveSlug(redacted, opts.title);
  const finalPath = resolve(FOLDERS.INBOX_RAW, `${ts}-${slug}.md`);
  const body = buildFrontmatter(opts, sourceHint) + contentBody;
  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, body, 'utf-8');
  await rename(tmpPath, finalPath);

  return {
    ok: true,
    kind: 'inbox',
    path: finalPath,
    relPath: homeRelative(finalPath),
    bytes: body.length,
    duplicate: false
  };
}

async function captureToFeedback(opts: CaptureOpts, content: string): Promise<CaptureResult> {
  const redacted = redactSecrets(content).trim();
  if (!redacted) throw new Error('Empty feedback content after redaction');

  const header = opts.label ? `## ${nowISO()} — ${opts.label}` : `## ${nowISO()}`;
  const entry = `\n\n---\n\n${header}\n\n${redacted}\n`;

  await mkdir(FOLDERS.USER_RAW, { recursive: true });
  if (!existsSync(FILES.FEEDBACK)) {
    await writeFile(
      FILES.FEEDBACK,
      '# Feedback\n\nAppend-only correction + reaction log. Compiled into `memory/index.md` → `## Learnings`.\n',
      'utf-8'
    );
  }
  await appendFile(FILES.FEEDBACK, entry, 'utf-8');

  return {
    ok: true,
    kind: 'feedback',
    path: FILES.FEEDBACK,
    relPath: homeRelative(FILES.FEEDBACK),
    bytes: entry.length,
    duplicate: false
  };
}

export async function capture(opts: CaptureOpts): Promise<CaptureResult> {
  const kind: CaptureKind = opts.kind ?? 'inbox';
  const { content, sourceHint } = await resolveContent(opts);
  if (kind === 'feedback') return captureToFeedback(opts, content);
  return captureToInbox(opts, content, sourceHint);
}
