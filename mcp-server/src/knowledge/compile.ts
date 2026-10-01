/**
 * Unified compile orchestration — sessions, feedback, inbox.
 *
 * Pure I/O + state. No LLM calls. The MCP server returns the next work item
 * (with a fully-rendered prompt and source content); the calling Claude
 * session synthesizes (Read/Write/Edit) and confirms via markComplete.
 */
import { FILES, FOLDERS, KNOWLEDGE } from '@/config';
import { chunkSessionLog } from '@/knowledge/chunk';
import { ENTRY_HEADER_RE } from '@/knowledge/session-format';
import { loadState, saveState } from '@/knowledge/state';
import { hashBuffer, listInboxFiles, listRawFiles, loadScriptTemplate, renderTemplate } from '@/knowledge/utils';
import type { CompileState, IngestedEntry, PartialEntry } from '@/shared/types';
import { agentDisplayName } from '@/shared/agent-name';
import { nowISO } from '@/shared/date';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, posix, relative, resolve, sep } from 'node:path';

/**
 * Byte offset of `buf` already compiled, per the file's ingest record.
 *
 * - Incremental record (`bytes` set): trust the cursor only if `prefix_hash`
 *   still matches `[0, bytes)` — a pure append leaves the prefix intact, a
 *   rewrite/edit doesn't, and that mismatch forces a from-scratch recompile.
 * - Legacy record (no `bytes`): fall back to whole-file hash gating —
 *   unchanged ⇒ fully compiled, changed ⇒ recompile whole. Past day-files
 *   never change, so they stay compiled without ever growing a `bytes` field.
 * - No record: nothing compiled yet.
 *
 * All offsets are byte offsets into the file; slices are taken with
 * `Buffer.subarray` (never string indices) so multibyte header glyphs
 * (en-dash, ↩, ⚠) don't skew them.
 */
function compiledOffset(buf: Buffer, record: IngestedEntry | undefined): number {
  if (!record) return 0;
  if (record.bytes != null) {
    const intact = record.bytes <= buf.length && record.prefix_hash === hashBuffer(buf.subarray(0, record.bytes));
    return intact ? record.bytes : 0;
  }
  return record.hash === hashBuffer(buf) ? buf.length : 0;
}

/** Advance a file's compile cursor to `sliceEnd` after a slice fully compiles.
 *  `prefix_hash` covers `[0, sliceEnd)` so the next run can tell a pure append
 *  (cursor still valid) from a rewrite (recompile from scratch). */
function promoteCursor(state: CompileState, fileName: string, buf: Buffer, sliceEnd: number, addedCost: number): void {
  const prev = state.ingested[fileName];
  const wholeHash = hashBuffer(buf);
  state.ingested[fileName] = {
    hash: wholeHash,
    compiled_at: nowISO(),
    cost_usd: (prev?.cost_usd ?? 0) + addedCost,
    bytes: sliceEnd,
    // When the slice reached EOF the prefix is the whole file — reuse the hash.
    prefix_hash: sliceEnd === buf.length ? wholeHash : hashBuffer(buf.subarray(0, sliceEnd))
  };
}

const SESSION_TEMPLATE = loadScriptTemplate(import.meta.url, 'compile.md');
const FEEDBACK_TEMPLATE = loadScriptTemplate(import.meta.url, 'feedback.md');
const INBOX_TEMPLATE = loadScriptTemplate(import.meta.url, 'inbox.md');

export type CompileKind = 'session' | 'feedback' | 'inbox';

export interface CompileWorkItem {
  itemId: string;
  kind: CompileKind;
  fileName: string;
  prompt: string;
  meta: Record<string, unknown>;
}

export interface CompileStatus {
  pending: { sessions: number; feedback: number; inbox: number };
  inFlight: string | null;
  totalIngested: number;
}

// ── Pending discovery ────────────────────────────────────────────────

async function pendingSessions(state: CompileState): Promise<string[]> {
  const all = await listRawFiles();
  const results = await Promise.all(
    all.map(async (logPath) => {
      const fileName = basename(logPath);
      // A pinned partial is always pending — resume it before anything else.
      if (state.partial[fileName]) return logPath;
      const buf = await readFile(logPath);
      const start = compiledOffset(buf, state.ingested[fileName]);
      if (start >= buf.length) return null;
      // Pending only if the uncompiled tail actually holds an entry — guards
      // against re-picking a file whose only growth was trailing whitespace.
      return ENTRY_HEADER_RE.test(buf.subarray(start).toString('utf-8')) ? logPath : null;
    })
  );
  return results.filter((p): p is string => p !== null);
}

async function feedbackChanged(state: CompileState): Promise<{ changed: boolean; hash: string | null }> {
  if (!existsSync(FILES.FEEDBACK)) return { changed: false, hash: null };
  const buf = await readFile(FILES.FEEDBACK);
  const hash = hashBuffer(buf);
  const prev = state.ingested['feedback'];
  return { changed: !prev || prev.hash !== hash, hash };
}

const inboxRelative = (abs: string): string => relative(FOLDERS.INBOX_RAW, abs);

const archivedRelPath = (inboxRel: string): string => posix.join('raw/archive/inbox', ...inboxRel.split(sep));

/**
 * Removes inbox folders the archive emptied, up to the inbox root; a Finder `.DS_Store` doesn't count as content.
 */
async function pruneEmptyInboxDirs(dir: string): Promise<void> {
  if (dir === FOLDERS.INBOX_RAW || inboxRelative(dir).startsWith('..')) {
    return;
  }
  const entries = await readdir(dir);
  if (entries.some((name) => name !== '.DS_Store')) {
    return;
  }
  await rm(dir, { recursive: true, force: true });
  await pruneEmptyInboxDirs(dirname(dir));
}

const unusedDir = (base: string, attempt = 1): string => {
  const candidate = attempt === 1 ? base : `${base}-${attempt}`;
  return existsSync(candidate) ? unusedDir(base, attempt + 1) : candidate;
};

const expandInboxZip = (zip: string): void => {
  const dest = unusedDir(resolve(dirname(zip), basename(zip, extname(zip))));
  try {
    execFileSync('unzip', ['-q', zip, '-d', dest, '-x', '__MACOSX/*'], { stdio: 'ignore' });
  } catch (cause) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(`Could not unzip ${inboxRelative(zip)}: fix or remove it from the inbox`, { cause });
  }
  const archived = resolve(FOLDERS.INBOX_ARCHIVE, inboxRelative(zip));
  mkdirSync(dirname(archived), { recursive: true });
  renameSync(zip, archived);
};

/**
 * Unpacks each zip in the inbox into a folder beside it and archives the zip, so its files compile one by one.
 */
const expandInboxZips = (): void =>
  listInboxFiles()
    .filter((abs) => extname(abs).toLowerCase() === '.zip')
    .forEach(expandInboxZip);

// ── Prompt builders ──────────────────────────────────────────────────
// The manual, USER.md, the wiki index, and the memory index are in the caller's
// context already; embedding them pushed every result past the host's cap.

function buildSessionPrompt(fileName: string, chunkContent: string): string {
  return renderTemplate(SESSION_TEMPLATE, {
    agentName: agentDisplayName(),
    fileName,
    logContent: chunkContent,
    userKnowledgeDir: FOLDERS.USER_KNOWLEDGE,
    memoryDir: FOLDERS.MEMORY,
    memoryIndex: FILES.MEMORY,
    knowledgeDir: FOLDERS.KNOWLEDGE
  });
}

async function buildFeedbackPrompt(): Promise<string> {
  const feedback = await readFile(FILES.FEEDBACK, 'utf-8');
  return renderTemplate(FEEDBACK_TEMPLATE, {
    agentName: agentDisplayName(),
    memoryIndexPath: FILES.MEMORY,
    feedback,
    now: nowISO()
  });
}

const READ_BY_PATH_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic']);

const isBinaryInboxFile = (inboxPath: string, buf: Buffer): boolean =>
  READ_BY_PATH_EXTENSIONS.has(extname(inboxPath).toLowerCase()) || buf.subarray(0, 8000).includes(0);

const readByPathNote = (inboxPath: string): string =>
  [
    `_This file is binary (\`${extname(inboxPath) || 'no extension'}\`), so its content is not inlined here. Read it from \`${inboxPath}\` with your file-reading tool before writing anything._`,
    '',
    `_Read a PDF in page ranges of at most 20 pages until you have covered every page. If your host can't read PDFs, run \`pdftotext -layout "${inboxPath}" -\` instead. If you can't read the format at all, write no articles and say which format it was._`
  ].join('\n');

async function buildInboxPrompt(inboxPath: string): Promise<string> {
  const fileName = inboxRelative(inboxPath);
  const buf = await readFile(inboxPath);
  const inboxContent = isBinaryInboxFile(inboxPath, buf) ? readByPathNote(inboxPath) : buf.toString('utf-8');
  return renderTemplate(INBOX_TEMPLATE, {
    agentName: agentDisplayName(),
    fileName,
    inboxContent,
    archivedRelPath: archivedRelPath(fileName),
    knowledgeDir: FOLDERS.KNOWLEDGE
  });
}

// ── Pick / mark ──────────────────────────────────────────────────────

export async function pickNext(): Promise<CompileWorkItem | null> {
  const state = await loadState();
  if (state.in_flight) {
    state.in_flight = null;
    await saveState(state);
  }

  // 1. Sessions — incremental: hand out the next chunk of the next pending
  //    file's uncompiled tail. pendingSessions only returns files with real
  //    uncompiled chunks, so there's exactly one slice to consider here.
  const sessionsPending = await pendingSessions(state);
  if (sessionsPending.length > 0) {
    const logPath = sessionsPending[0];
    const fileName = basename(logPath);
    const buf = await readFile(logPath);

    // Resolve the slice [sliceStart, sliceEnd). A pinned partial wins — so an
    // append mid-compile can't shift chunk boundaries — unless its region no
    // longer hashes the same (an unexpected rewrite), in which case re-slice.
    let pinned: PartialEntry | undefined = state.partial[fileName];
    if (pinned && hashBuffer(buf.subarray(pinned.slice_start, pinned.slice_end)) !== pinned.hash) {
      delete state.partial[fileName];
      pinned = undefined;
    }
    const sliceStart = pinned ? pinned.slice_start : compiledOffset(buf, state.ingested[fileName]);
    const sliceEnd = pinned ? pinned.slice_end : buf.length;
    const sliceBuf = buf.subarray(sliceStart, sliceEnd);
    // A valid pinned slice already hashed equal to pinned.hash above — reuse it.
    const sliceHash = pinned ? pinned.hash : hashBuffer(sliceBuf);
    const chunks = chunkSessionLog(sliceBuf.toString('utf-8'), KNOWLEDGE.MAX_SESSION_LOG_CHUNK_BYTES);
    const chunkIndex = pinned ? pinned.completed : 0;
    const costSoFar = pinned ? pinned.cost_usd : 0;

    // Pin the slice so markComplete (and any re-pick) resumes it identically.
    state.partial[fileName] = {
      hash: sliceHash,
      slice_start: sliceStart,
      slice_end: sliceEnd,
      completed: chunkIndex,
      total: chunks.length,
      cost_usd: costSoFar
    };
    state.in_flight = fileName;
    const prompt = await buildSessionPrompt(fileName, chunks[chunkIndex]);
    await saveState(state);
    return {
      itemId: `session:${fileName}:${chunkIndex}`,
      kind: 'session',
      fileName,
      prompt,
      meta: { sourcePath: logPath, sliceStart, sliceEnd, chunkIndex, totalChunks: chunks.length, costSoFar }
    };
  }

  // 2. Feedback — single file, synthesised when its hash changes.
  const fb = await feedbackChanged(state);
  if (fb.changed) {
    const prompt = await buildFeedbackPrompt();
    state.in_flight = 'feedback';
    await saveState(state);
    return {
      itemId: 'feedback',
      kind: 'feedback',
      fileName: 'feedback',
      prompt,
      meta: { hash: fb.hash, path: FILES.FEEDBACK }
    };
  }

  // 3. Inbox.
  expandInboxZips();
  const inboxItems = listInboxFiles();
  if (inboxItems.length > 0) {
    const inboxPath = inboxItems[0];
    const fileName = inboxRelative(inboxPath);
    const prompt = await buildInboxPrompt(inboxPath);
    state.in_flight = `inbox/${fileName}`;
    await saveState(state);
    return {
      itemId: `inbox:${fileName}`,
      kind: 'inbox',
      fileName,
      prompt,
      meta: { sourcePath: inboxPath, archivedTo: resolve(FOLDERS.INBOX_ARCHIVE, fileName) }
    };
  }

  return null;
}

type CompleteHandler = (itemId: string, state: CompileState) => Promise<boolean>;

const HANDLERS: Array<[string, CompleteHandler]> = [
  [
    'session:',
    async (itemId, state) => {
      const match = /^session:(.+):(\d+)$/.exec(itemId);
      if (!match) throw new Error(`Invalid session itemId: ${itemId}`);
      const fileName = match[1];
      const chunkIndex = parseInt(match[2], 10);
      // pickNext pins the slice (start/end/total) before handing out any chunk,
      // so there's no re-chunking here. A missing partial means there's nothing
      // to advance (already promoted, or state was reset).
      const partial = state.partial[fileName];
      if (!partial) return true;
      const nextChunk = chunkIndex + 1;
      if (nextChunk >= partial.total) {
        const logPath = resolve(FOLDERS.SESSIONS, fileName);
        const buf = await readFile(logPath).catch(() => {
          throw new Error(`Source file vanished: ${fileName}`);
        });
        promoteCursor(state, fileName, buf, partial.slice_end, partial.cost_usd);
        delete state.partial[fileName];
        return true;
      }
      state.partial[fileName] = { ...partial, completed: nextChunk };
      return false;
    }
  ],
  [
    'feedback',
    async (_itemId, state) => {
      if (!existsSync(FILES.FEEDBACK)) return true;
      const buf = await readFile(FILES.FEEDBACK);
      state.ingested['feedback'] = {
        hash: hashBuffer(buf),
        compiled_at: nowISO(),
        cost_usd: 0
      };
      return true;
    }
  ],
  [
    'inbox:',
    async (itemId) => {
      const fileName = itemId.slice('inbox:'.length);
      const src = resolve(FOLDERS.INBOX_RAW, fileName);
      const rel = inboxRelative(src);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`Inbox item is outside the inbox: ${fileName}`);
      }
      if (existsSync(src)) {
        const dest = resolve(FOLDERS.INBOX_ARCHIVE, fileName);
        await mkdir(dirname(dest), { recursive: true });
        await rename(src, dest);
        await pruneEmptyInboxDirs(dirname(src));
      }
      return true;
    }
  ]
];

export async function markComplete(itemId: string): Promise<{ ok: true; promoted: boolean; kind: CompileKind }> {
  const state = await loadState();
  state.in_flight = null;

  for (const [prefix, handler] of HANDLERS) {
    // Prefixes ending in `:` are namespace prefixes (e.g. `session:<file>`,
    // `inbox:<file>`) and match via startsWith. Bare prefixes (e.g. `feedback`)
    // must match exactly, otherwise `feedbackXYZ` would route here too.
    const matches = prefix.endsWith(':') ? itemId.startsWith(prefix) : itemId === prefix;
    if (matches) {
      const promoted = await handler(itemId, state);
      await saveState(state);
      const kind = prefix.replace(':', '') as CompileKind;
      return { ok: true, promoted, kind };
    }
  }

  await saveState(state);
  throw new Error(`Unknown itemId prefix: ${itemId}`);
}

export async function getStatus(): Promise<CompileStatus> {
  const state = await loadState();
  const [sessions, fb] = await Promise.all([pendingSessions(state), feedbackChanged(state)]);
  const inboxItems = listInboxFiles();
  return {
    pending: {
      sessions: sessions.length,
      feedback: fb.changed ? 1 : 0,
      inbox: inboxItems.length
    },
    inFlight: state.in_flight,
    totalIngested: Object.keys(state.ingested).length
  };
}
