/**
 * Structured logger for agent-kevin — MCP server, tools, CLI, hook scripts.
 *
 * Default routing:
 *   - stderr = every level (MCP stdout is reserved for JSON-RPC; the hook
 *     scripts in `scripts/` reserve stdout for protocol payloads). We never
 *     write logs to stdout, so this module is safe to import from anywhere.
 *   - file   = every level (durable audit, <HOME>/<data-dir>/logs/app.log)
 *
 * No setStderrOnly() toggle. There is no path that writes to stdout — so the
 * logger is hook-safe by construction. Override the file path via
 * `AGENT_LOG_FILE`; disable file output entirely with `AGENT_LOG_FILE=off`.
 * Dependency-free, so it reads only the shared `AGENT_*` names — it can't
 * derive the per-agent override prefix; the env gate writes the resolved home
 * back to `AGENT_HOME`, which covers the default path below.
 *
 * File output rotates when it crosses MAX_LOG_BYTES (5MB) to a timestamped
 * sibling (`app.20260523-160300.log`). No auto-delete — operator prunes
 * `<HOME>/<data-dir>/logs/` when desired.
 *
 * Scopes are one per module, with chainable sub-scopes:
 *   log.knowledge.with('compile').warn('parse failed')
 *   // → [...] WARN [📚 knowledge] [compile] parse failed
 *
 * `with()` accepts a static string OR a lazy `() => string` closure so a sub
 * scope can reference a not-yet-defined constant (e.g. a tool's `name`).
 *
 * Secrets are scrubbed two ways before serialisation:
 *   - any env value listed in SENSITIVE_KEYS is replaced with [REDACTED]
 *   - any literal Bearer token / JWT pattern is masked
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// ── Config ────────────────────────────────────────────────────────────

let minLevel: Level = ((process.env.AGENT_LOG_LEVEL ?? process.env.LOG_LEVEL) as Level) ?? 'info';
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Resolved at first write to avoid forcing a circular import on `@/config`
 * (which would drag the whole FOLDERS tree into hook scripts that just want
 * to log a line). `AGENT_LOG_FILE` tells us where to write; `=off` disables.
 */
function resolveLogFile(): string | null {
  const env = process.env.AGENT_LOG_FILE?.trim();
  if (env === 'off') return null;
  if (env) return resolve(env);
  // Default: <HOME>/<data-dir>/logs/app.log. AGENT_HOME mirrors the MCP server's
  // resolution (the env gate canonicalizes it even when a per-agent override
  // supplied the home); if unset, fall back to cwd so hooks still capture. The
  // data-dir read mirrors `runtimeDirName()` in shared/env.ts — inlined so this
  // module stays dependency-free.
  const home = (process.env.AGENT_HOME?.trim() || process.cwd()).replace(/\/$/, '');
  return resolve(home, process.env.AGENT_RUNTIME_DIR?.trim() || '.kevin', 'logs', 'app.log');
}

/** Env-var names whose values must never appear verbatim in any log line. */
const SENSITIVE_KEYS = [
  'PERPLEXITY_API_KEY',
  'SERPAPI_KEY',
  'OPENPAGERANK_API_KEY',
  'GOOGLE_OAUTH_CLIENT_SECRET'
] as const;

// ── Rotation helpers ──────────────────────────────────────────────────

/** Local-time timestamp suffix for rotated files: 20260523-160300. */
function rotationStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function rotateIfNeeded(logFile: string): void {
  try {
    if (!existsSync(logFile)) return;
    if (statSync(logFile).size < MAX_LOG_BYTES) return;
    const idx = logFile.lastIndexOf('.log');
    const rotated = idx >= 0 ? `${logFile.slice(0, idx)}.${rotationStamp()}.log` : `${logFile}.${rotationStamp()}`;
    renameSync(logFile, rotated);
  } catch {
    // best-effort rotation — logging must never crash the caller
  }
}

// ── Scrubber ──────────────────────────────────────────────────────────

const TOKEN_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._-]+/gi, // Authorization: Bearer <token>
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWTs
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@\S+/gi // connection strings: scheme://user:pass@host
];

function scrub(str: string): string {
  let out = str;
  for (const key of SENSITIVE_KEYS) {
    const value = process.env[key];
    if (value && value.length >= 8) out = out.split(value).join('[REDACTED]');
  }
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

function serializeMeta(meta: unknown): string {
  if (meta instanceof Error) {
    return JSON.stringify({
      error: scrub(meta.message),
      stack: meta.stack?.split('\n').slice(0, 3).map(scrub).join(' <- ')
    });
  }
  try {
    return scrub(JSON.stringify(meta));
  } catch {
    return scrub(String(meta));
  }
}

// ── Emit ──────────────────────────────────────────────────────────────

let cachedLogFile: string | null | undefined;

function writeToFile(line: string): void {
  if (cachedLogFile === undefined) cachedLogFile = resolveLogFile();
  if (cachedLogFile === null) return;
  try {
    const dir = cachedLogFile.slice(0, cachedLogFile.lastIndexOf('/'));
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotateIfNeeded(cachedLogFile);
    appendFileSync(cachedLogFile, line + '\n');
  } catch {
    // best-effort file write — never crash the caller
  }
}

function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  const tag = level.toUpperCase().padEnd(5);
  const head = `${new Date().toISOString()} ${tag} [${scope}] ${scrub(message)}`;
  const line = meta !== undefined ? `${head} | ${serializeMeta(meta)}` : head;

  // stderr only — MCP stdout is JSON-RPC, hook scripts reserve stdout for
  // protocol payloads. There is no level that ever writes to stdout.
  process.stderr.write(line + '\n');
  writeToFile(line);
}

// ── Public API ────────────────────────────────────────────────────────

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  /**
   * Return a child logger whose messages are auto-prefixed with `[<prefix>]`.
   * Accepts a string or a `() => string` (the latter lets you reference a
   * not-yet-defined constant, e.g. a plugin's `name`). Chainable:
   * `log.knowledge.with('compile').with('chunk')` → `[📚 knowledge] [compile] [chunk] …`.
   */
  with(prefix: string | (() => string)): Logger;
}

/** Raise or lower the runtime threshold. Per-process; no cross-process effect. */
export function setMinLevel(level: Level): void {
  minLevel = level;
}

function subLogger(scope: string, transform: (msg: string) => string): Logger {
  return {
    debug: (msg, meta) => emit('debug', scope, transform(msg), meta),
    info: (msg, meta) => emit('info', scope, transform(msg), meta),
    warn: (msg, meta) => emit('warn', scope, transform(msg), meta),
    error: (msg, meta) => emit('error', scope, transform(msg), meta),
    with: (prefix) => {
      const getPrefix = typeof prefix === 'function' ? prefix : () => prefix;
      return subLogger(scope, (msg) => transform(`[${getPrefix()}] ${msg}`));
    }
  };
}

export function createLogger(scope: string): Logger {
  return subLogger(scope, (msg) => msg);
}

// Pre-built per-module loggers. One scope per module; sub-sources attach via
// `.with('sub')`. Top-level `log.info/warn/error` map to the system scope so
// existing call sites (server.ts boot, tool handlers) keep working.
const system = createLogger('🤖 system');

export const log = {
  debug: system.debug,
  info: system.info,
  warn: system.warn,
  error: system.error,
  with: system.with,
  system,
  knowledge: createLogger('📚 knowledge'),
  tasks: createLogger('📋 tasks'),
  session: createLogger('🪝 session'),
  tools: createLogger('🔧 tools'),
  mcp: createLogger('🛰 mcp')
};
