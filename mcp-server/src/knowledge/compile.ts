/**
 * Unified compile orchestration — sessions, feedback, specs.
 *
 * Pure I/O + state. No LLM calls. The MCP server returns the next work item
 * (with a fully-rendered prompt and source content); the calling Claude
 * session synthesizes (Read/Write/Edit) and confirms via markComplete.
 */
import { FILES, FOLDERS, KNOWLEDGE } from '@/config';
import { chunkSessionLog } from '@/knowledge/chunk';
import { loadState, saveState } from '@/knowledge/state';
import { hashBuffer, listRawFiles, loadScriptTemplate, readWikiIndex, renderTemplate } from '@/knowledge/utils';
import type { CompileState } from '@/shared/types';
import { nowISO } from '@/shared/date';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const SESSION_TEMPLATE = loadScriptTemplate(import.meta.url, 'compile.md');
const FEEDBACK_TEMPLATE = loadScriptTemplate(import.meta.url, 'feedback.md');
const SPECS_TEMPLATE = loadScriptTemplate(import.meta.url, 'specs.md');

export type CompileKind = 'session' | 'feedback' | 'specs';

export interface CompileWorkItem {
  itemId: string;
  kind: CompileKind;
  fileName: string;
  prompt: string;
  meta: Record<string, unknown>;
}

export interface CompileStatus {
  pending: { sessions: number; feedback: number; specs: number };
  inFlight: string | null;
  totalIngested: number;
}

// ── Pending discovery ────────────────────────────────────────────────

async function pendingSessions(state: CompileState): Promise<string[]> {
  const all = await listRawFiles();
  const results = await Promise.all(
    all.map(async (logPath) => {
      const prev = state.ingested[basename(logPath)];
      if (!prev) return logPath;
      const buf = await readFile(logPath);
      return prev.hash !== hashBuffer(buf) ? logPath : null;
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

async function listSpecArtifacts(): Promise<string[]> {
  try {
    const entries = await readdir(FOLDERS.SPECS_RAW, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => resolve(FOLDERS.SPECS_RAW, e.name))
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

async function buildSpecPrompt(specPath: string): Promise<string> {
  const fileName = basename(specPath);
  const [specContent, wikiIndex] = await Promise.all([
    readFile(specPath, 'utf-8'),
    readWikiIndex()
  ]);
  return renderTemplate(SPECS_TEMPLATE, {
    wikiIndex,
    fileName,
    specContent,
    archivedRelPath: `raw/archive/specs/${fileName}`,
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

  // 1. Sessions — promote-and-continue loop avoids re-scanning on each promotion.
  while (true) {
    const sessionsPending = await pendingSessions(state);
    if (sessionsPending.length === 0) break;
    const logPath = sessionsPending[0];
    const fileName = basename(logPath);
    const buf = await readFile(logPath);
    const hash = hashBuffer(buf);
    const chunks = chunkSessionLog(buf.toString('utf-8'), KNOWLEDGE.MAX_SESSION_LOG_CHUNK_BYTES);

    const prior = state.partial[fileName];
    let chunkIndex = 0;
    let costSoFar = 0;
    if (prior && prior.hash === hash && prior.total === chunks.length) {
      chunkIndex = prior.completed;
      costSoFar = prior.cost_usd;
    } else if (prior) {
      delete state.partial[fileName];
    }

    if (chunkIndex >= chunks.length) {
      delete state.partial[fileName];
      state.ingested[fileName] = { hash, compiled_at: nowISO(), cost_usd: costSoFar };
      await saveState(state);
      continue;
    }

    const prompt = await buildSessionPrompt(fileName, chunks[chunkIndex]);
    state.in_flight = fileName;
    await saveState(state);
    return {
      itemId: `session:${fileName}:${chunkIndex}`,
      kind: 'session',
      fileName,
      prompt,
      meta: { sourcePath: logPath, hash, chunkIndex, totalChunks: chunks.length, costSoFar }
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

  // 3. Specs.
  const specs = await listSpecArtifacts();
  if (specs.length > 0) {
    const specPath = specs[0];
    const fileName = basename(specPath);
    const prompt = await buildSpecPrompt(specPath);
    state.in_flight = `specs/${fileName}`;
    await saveState(state);
    return {
      itemId: `specs:${fileName}`,
      kind: 'specs',
      fileName,
      prompt,
      meta: { sourcePath: specPath, archivedTo: resolve(FOLDERS.SPECS_ARCHIVE, fileName) }
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
      const logPath = resolve(FOLDERS.SESSIONS, fileName);
      const buf = await readFile(logPath).catch(() => {
        throw new Error(`Source file vanished: ${fileName}`);
      });
      const hash = hashBuffer(buf);
      // Read total from partial state when available — avoids re-chunking the
      // full file just to recompute `.length`. First chunk has no prior partial
      // so we still pay the chunking cost there.
      const prior = state.partial[fileName];
      const totalChunks =
        prior?.hash === hash ? prior.total : chunkSessionLog(buf.toString('utf-8'), KNOWLEDGE.MAX_SESSION_LOG_CHUNK_BYTES).length;
      const costSoFar = prior?.cost_usd ?? 0;
      const nextChunk = chunkIndex + 1;
      if (nextChunk >= totalChunks) {
        delete state.partial[fileName];
        state.ingested[fileName] = { hash, compiled_at: nowISO(), cost_usd: costSoFar };
        return true;
      }
      state.partial[fileName] = { hash, completed: nextChunk, total: totalChunks, cost_usd: costSoFar };
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
    'specs:',
    async (itemId) => {
      const fileName = itemId.slice('specs:'.length);
      const src = resolve(FOLDERS.SPECS_RAW, fileName);
      if (existsSync(src)) {
        await mkdir(FOLDERS.SPECS_ARCHIVE, { recursive: true });
        await rename(src, resolve(FOLDERS.SPECS_ARCHIVE, fileName));
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
    // `specs:<file>`) and match via startsWith. Bare prefixes (e.g. `feedback`)
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
  const [sessions, fb, specs] = await Promise.all([
    pendingSessions(state),
    feedbackChanged(state),
    listSpecArtifacts()
  ]);
  return {
    pending: {
      sessions: sessions.length,
      feedback: fb.changed ? 1 : 0,
      specs: specs.length
    },
    inFlight: state.in_flight,
    totalIngested: Object.keys(state.ingested).length
  };
}
