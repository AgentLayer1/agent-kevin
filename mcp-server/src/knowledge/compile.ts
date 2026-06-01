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
import { hashBuffer, listRawFiles, loadScriptTemplate, readWikiIndex, renderTemplate } from '@/knowledge/utils';
import type { CompileState, IngestedEntry, PartialEntry } from '@/shared/types';
import { nowISO } from '@/shared/date';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

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
    const intact =
      record.bytes <= buf.length && record.prefix_hash === hashBuffer(buf.subarray(0, record.bytes));
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

async function listInboxArtifacts(): Promise<string[]> {
  try {
    const entries = await readdir(FOLDERS.INBOX_RAW, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => resolve(FOLDERS.INBOX_RAW, e.name))
      .sort();
  } catch {
    return [];
  }
}

// ── Prompt builders (parallel reads) ─────────────────────────────────

/**
 * Read Kevin's operating manual. Two possible locations depending on whether
 * a pre-existing CLAUDE.md was found at /init time:
 *   1. <HOME>/CLAUDE.local.md — present only when init detected a collision
 *      with the user's existing CLAUDE.md and wrote Kevin's version alongside.
 *   2. <HOME>/CLAUDE.md       — the default location, no collision case.
 * CLAUDE.local.md takes priority because, when both exist, the local one is
 * Kevin's and the bare CLAUDE.md belongs to the user.
 */
async function readOperatingManual(): Promise<string> {
  for (const path of [FILES.CLAUDE_LOCAL, FILES.CLAUDE]) {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      continue;
    }
  }
  return '(operating manual not found — run /agent-kevin:init)';
}

async function buildSessionPrompt(fileName: string, chunkContent: string): Promise<string> {
  const [schema, user, wikiIndex] = await Promise.all([
    readOperatingManual(),
    readFile(FILES.USER, 'utf-8').catch(() => '(USER.md not found — run /agent-kevin:init)'),
    readWikiIndex()
  ]);
  return renderTemplate(SESSION_TEMPLATE, {
    schema,
    user,
    wikiIndex,
    fileName,
    logContent: chunkContent,
    userKnowledgeDir: FOLDERS.USER_KNOWLEDGE,
    memoryDir: FOLDERS.MEMORY,
    memoryIndex: FILES.MEMORY,
    knowledgeDir: FOLDERS.KNOWLEDGE
  });
}

async function buildFeedbackPrompt(): Promise<string> {
  const [feedback, memoryIndex] = await Promise.all([
    readFile(FILES.FEEDBACK, 'utf-8'),
    readFile(FILES.MEMORY, 'utf-8').catch(
      () => '(file does not exist yet — create it with the standard memory index structure)'
    )
  ]);
  return renderTemplate(FEEDBACK_TEMPLATE, {
    memoryIndexPath: FILES.MEMORY,
    memoryIndex,
    feedback,
    now: nowISO()
  });
}

async function buildInboxPrompt(inboxPath: string): Promise<string> {
  const fileName = basename(inboxPath);
  const [inboxContent, wikiIndex] = await Promise.all([readFile(inboxPath, 'utf-8'), readWikiIndex()]);
  return renderTemplate(INBOX_TEMPLATE, {
    wikiIndex,
    fileName,
    inboxContent,
    archivedRelPath: `raw/archive/inbox/${fileName}`,
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
  const inboxItems = await listInboxArtifacts();
  if (inboxItems.length > 0) {
    const inboxPath = inboxItems[0];
    const fileName = basename(inboxPath);
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
      if (existsSync(src)) {
        await mkdir(FOLDERS.INBOX_ARCHIVE, { recursive: true });
        await rename(src, resolve(FOLDERS.INBOX_ARCHIVE, fileName));
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
  const [sessions, fb, inboxItems] = await Promise.all([
    pendingSessions(state),
    feedbackChanged(state),
    listInboxArtifacts()
  ]);
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
