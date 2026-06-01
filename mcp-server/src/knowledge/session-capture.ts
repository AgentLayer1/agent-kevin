/**
 * Harness-agnostic session-capture core. Used by:
 *  - Claude Code's SessionEnd / PreCompact hooks via `bin/kevin session-capture --hook-protocol=claude`.
 *  - Future harnesses (Codex, Pi, ...) — each adds a transcript-format adapter
 *    + a `--hook-protocol=<host>` envelope in `bin/kevin`.
 *
 * This module knows nothing about hook envelopes (stdin/stdout JSON shapes) —
 * that's the CLI wrapper's job. It takes plain args, applies self-defer +
 * exclusion + min-turns filtering + secret redaction, and appends to today's
 * session log.
 */
import { FOLDERS, KNOWLEDGE, PLUGIN_NAME, isInitialized } from '@/config';
import { ENTRY_SEPARATOR, formatEntryHeader } from '@/knowledge/session-format';
import {
  diffTurns,
  fingerprintTurn,
  loadIndex,
  recordCapture,
  saveIndex
} from '@/knowledge/session-index';
import { redactSecrets } from '@/knowledge/utils';
import { nowTime, todayDate } from '@/shared/date';
import { log as baseLog } from '@/shared/log';
import type { TranscriptTurn } from '@/shared/types';
import { expandTilde } from '@/shared/utils';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { relative, resolve } from 'node:path';

const log = baseLog.session.with('capture');

export type CaptureMode = 'session-end' | 'pre-compact';
export type CaptureFormat = 'claude';

interface ModeConfig {
  heading: string;
  minTurns: number;
}

const MODES: Record<CaptureMode, ModeConfig> = {
  'session-end': { heading: 'Session', minTurns: 1 },
  'pre-compact': { heading: 'Pre-Compact', minTurns: 5 }
};

// ── Transcript extractors ────────────────────────────────────────────

type Extractor = (transcriptPath: string) => TranscriptTurn[];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Flatten a Claude Code content block (string or structured array) into text. */
function claudeContentToText(content: unknown): string {
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
 * Claude Code transcript extractor. Reads the JSONL transcript at the given
 * path and returns only the user/assistant text turns — tool results,
 * non-text blocks, system-reminders, and slash-command artefacts are
 * filtered out.
 */
const claudeExtractor: Extractor = (transcriptPath) => {
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

    const text = claudeContentToText(msg.content).trim();
    if (!text) continue;
    if (text.startsWith('<system-reminder>') || text.startsWith('<command-name>')) continue;

    turns.push({ role, text });
  }
  return turns;
};

const EXTRACTORS: Record<CaptureFormat, Extractor> = {
  claude: claudeExtractor
};

// ── Defer + exclusion helpers ────────────────────────────────────────

/** True when called by Claude Code's plugin-hook invocation (sets CLAUDE_PLUGIN_ROOT). */
function isPluginInvocation(): boolean {
  return Boolean(process.env.CLAUDE_PLUGIN_ROOT);
}

/** True when the project at `cwd` has *this* plugin (PLUGIN_NAME) enabled. */
function pluginEnabledInCwd(cwd: string): boolean {
  if (!cwd) return false;
  const settingsPath = resolve(cwd, '.claude/settings.json');
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      enabledPlugins?: Record<string, boolean>;
    };
    return Object.entries(settings.enabledPlugins ?? {}).some(
      ([key, enabled]) => enabled === true && key.startsWith(`${PLUGIN_NAME}@`)
    );
  } catch {
    return false;
  }
}

/**
 * Returns the matching exclude path when `cwd` falls under any of them
 * (exact or `/`-bounded prefix), else null. The `/` boundary stops
 * `/foo/bar` from excluding `/foo/barbaz`.
 */
function matchedExclude(cwd: string, excludes: string[]): string | null {
  if (!cwd || excludes.length === 0) return null;
  const target = resolve(cwd);
  for (const path of excludes) {
    const absolute = resolve(expandTilde(path));
    if (target === absolute || target.startsWith(`${absolute}/`)) return absolute;
  }
  return null;
}

/** Render `cwd` as `~/<relative>` when under `$HOME`, else return unchanged. */
function homeRelative(cwd: string): string {
  if (!cwd) return 'unknown';
  const home = homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
  return cwd;
}

// ── Turn formatting ──────────────────────────────────────────────────

/**
 * Format a list of turns as a markdown-ish block. The per-turn cap stops one
 * oversized turn from devouring the budget. No trailing-window cap: incremental
 * capture writes only the turns appended since the last capture, so the batch
 * is naturally bounded by what happened since — and each turn is stored exactly
 * once. Oversized whole-batch slices are handled downstream by the compile
 * chunker, not by dropping turns here.
 */
function formatTurnList(turns: TranscriptTurn[]): string {
  return turns
    .map((turn) => {
      const role = turn.role === 'user' ? 'User' : 'Assistant';
      const text =
        turn.text.length > KNOWLEDGE.MAX_TURN_CHARS
          ? `${turn.text.slice(0, KNOWLEDGE.MAX_TURN_CHARS)}\n[… ${turn.text.length - KNOWLEDGE.MAX_TURN_CHARS} chars truncated]`
          : turn.text;
      return `**${role}:** ${text}\n`;
    })
    .join('\n');
}

/** One-line briefing seeded on a session's first capture (first user turn). */
function briefingStub(turns: TranscriptTurn[]): string {
  const firstUser = turns.find((turn) => turn.role === 'user');
  const text = (firstUser?.text ?? turns[0]?.text ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

// ── Capture mutex ────────────────────────────────────────────────────

const LOCK_DIR = resolve(FOLDERS.DATA, 'capture.lock');
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_MAX_WAIT_MS = 5_000;

/**
 * Cross-process mutex via atomic `mkdir`. Serializes the read-modify-write of
 * the session index + day-file append so two hooks firing for the same session
 * at once can't both read an empty cursor and both write a first-capture block.
 * A stale lock (a hook that crashed mid-capture) is stolen after LOCK_STALE_MS;
 * if the lock can't be taken within LOCK_MAX_WAIT_MS we proceed anyway —
 * dropping a capture is worse than a once-in-a-blue-moon duplicate.
 */
async function acquireCaptureLock(): Promise<() => Promise<void>> {
  await mkdir(FOLDERS.DATA, { recursive: true }); // ensure lock's parent exists
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  const release = async () => {
    await rm(LOCK_DIR, { recursive: true, force: true }).catch(() => {});
  };
  for (;;) {
    try {
      await mkdir(LOCK_DIR);
      return release;
    } catch {
      const age = await stat(LOCK_DIR)
        .then((s) => Date.now() - s.mtimeMs)
        .catch(() => Infinity);
      if (age > LOCK_STALE_MS) {
        await release();
        continue;
      }
      if (Date.now() >= deadline) {
        log.warn('capture lock contended past timeout — proceeding without it');
        return async () => {};
      }
      await new Promise((resolveFn) => setTimeout(resolveFn, LOCK_RETRY_MS));
    }
  }
}

// ── Public surface ───────────────────────────────────────────────────

export interface CaptureSessionOpts {
  transcriptPath: string;
  cwd: string;
  sessionId: string;
  mode: CaptureMode;
  excludes?: string[];
  format?: CaptureFormat;
  /**
   * When true, applies self-defer logic (skip if another plugin instance is
   * enabled in cwd, skip if cwd is excluded). Default mirrors today's
   * implicit behavior: defer when NOT invoked by a plugin hook (i.e. when
   * called from the user-level `~/.claude/settings.json` hook).
   */
  selfDefer?: boolean;
}

export type CaptureSessionReason =
  | 'not-initialized'
  | 'plugin-will-capture'
  | 'excluded'
  | 'no-transcript'
  | 'no-new-turns'
  | 'too-few-turns'
  | 'empty-after-redaction';

export type CaptureSessionResult =
  | { saved: true; turns: number; path: string; filename: string }
  | { saved: false; reason: CaptureSessionReason; turns?: number; detail?: string };

export async function captureSession(opts: CaptureSessionOpts): Promise<CaptureSessionResult> {
  const { mode } = opts;
  if (!isInitialized()) {
    log.info(`skip (${mode}) — /${PLUGIN_NAME}:init not run yet`);
    return { saved: false, reason: 'not-initialized' };
  }

  const selfDefer = opts.selfDefer ?? !isPluginInvocation();
  if (selfDefer) {
    if (pluginEnabledInCwd(opts.cwd)) {
      log.info(`skip (${mode}) — plugin hook will capture`);
      return { saved: false, reason: 'plugin-will-capture' };
    }
    const excluded = matchedExclude(opts.cwd, opts.excludes ?? []);
    if (excluded) {
      log.info(`skip (${mode}) — ${homeRelative(opts.cwd)} is excluded`);
      return { saved: false, reason: 'excluded', detail: excluded };
    }
  }

  if (!opts.transcriptPath || !existsSync(opts.transcriptPath)) {
    log.warn(`skip (${mode}) — no transcript at ${opts.transcriptPath}`);
    return { saved: false, reason: 'no-transcript' };
  }

  const extract = EXTRACTORS[opts.format ?? 'claude'];
  const turns = extract(opts.transcriptPath);
  const cfg = MODES[mode];

  // Resume-safe dedup: write only the turns appended since this session was
  // last captured. The cursor lives in the session index, keyed by sessionId,
  // so a session resumed on a later day still resolves to the right offset.
  const idShort = opts.sessionId.slice(0, 8);

  // Hold the capture mutex across the whole read-modify-write: load the index,
  // diff, append the block, and save the cursor as one atomic unit so two
  // concurrent hooks can't both write a first-capture block for this session.
  const release = await acquireCaptureLock();
  try {
    const index = await loadIndex();
    const prior = index.sessions[idShort] ?? null;
    const diff = diffTurns(turns, prior);

    if (diff.newTurns.length === 0) {
      log.info(`skip (${mode}) — no new turns since last capture (cursor ${prior?.captured_turns ?? 0})`);
      return { saved: false, reason: 'no-new-turns', turns: 0 };
    }
    if (diff.newTurns.length < cfg.minTurns) {
      // Don't advance the cursor — these turns are re-offered on the next capture.
      log.info(`skip (${mode}) — ${diff.newTurns.length} new turns (min ${cfg.minTurns})`);
      return { saved: false, reason: 'too-few-turns', turns: diff.newTurns.length };
    }
    if (diff.reanchored) {
      log.warn(`(${mode}) [${idShort}] cursor anchor mismatch — transcript rewritten; re-anchoring at turn ${diff.from}`);
    }

    const redacted = redactSecrets(formatTurnList(diff.newTurns));
    if (!redacted.trim()) {
      log.info(`skip (${mode}) — empty after redaction`);
      return { saved: false, reason: 'empty-after-redaction', turns: diff.newTurns.length };
    }

    const today = todayDate();
    const filename = `${today}.md`;
    const logPath = resolve(FOLDERS.SESSIONS, filename);

    await mkdir(FOLDERS.SESSIONS, { recursive: true });
    if (!existsSync(logPath)) {
      await writeFile(logPath, `# Session Log: ${today}\n\n`, 'utf-8');
    }

    const source = homeRelative(opts.cwd);
    const header = formatEntryHeader({
      heading: cfg.heading,
      time: nowTime(),
      idShort,
      date: today,
      source,
      from: diff.from,
      to: diff.to,
      continues: prior && diff.from !== 1 ? prior.first_seen : undefined,
      reanchored: diff.reanchored
    });
    await appendFile(logPath, `${header}\n\n${redacted}${ENTRY_SEPARATOR}`, 'utf-8');

    const updated = recordCapture(index, {
      sessionId: idShort,
      date: today,
      cwd: source,
      from: diff.from,
      to: diff.to,
      lastTurnFp: fingerprintTurn(turns[turns.length - 1]),
      briefingStub: briefingStub(diff.newTurns)
    });
    await saveIndex(updated);

    log.info(`saved turns ${diff.from}–${diff.to} → ${filename} (${mode})`);
    return { saved: true, turns: diff.newTurns.length, path: logPath, filename };
  } finally {
    await release();
  }
}
