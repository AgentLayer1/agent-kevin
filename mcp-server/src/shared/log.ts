/**
 * Stderr-only logger with scoped sub-loggers. stdout is reserved for MCP JSON-RPC.
 *
 * Two API shapes for compatibility with the agent-kevin codebase that this plugin
 * ports from:
 *   - createLogger('scope') -> { info, warn, error }  (tasks/* modules)
 *   - log.knowledge.with('sub') -> { info, warn, error }  (knowledge/* modules)
 *
 * Optional file tee when KEVIN_LOG_FILE is set.
 */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOG_FILE = process.env.KEVIN_LOG_FILE ? resolve(process.env.KEVIN_LOG_FILE) : null;

const stamp = () => new Date().toISOString();

function emit(level: 'INFO' | 'WARN' | 'ERROR', scope: string, message: string, extra?: unknown) {
  const tail = extra !== undefined ? ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : '';
  const line = `[${stamp()}] ${level} [${scope}] ${message}${tail}`;
  process.stderr.write(line + '\n');
  if (LOG_FILE) {
    try {
      appendFileSync(LOG_FILE, line + '\n');
    } catch {
      // best effort
    }
  }
}

export interface ScopedLogger {
  info: (msg: string, extra?: unknown) => void;
  warn: (msg: string, extra?: unknown) => void;
  error: (msg: string, extra?: unknown) => void;
  with: (subscope: string) => ScopedLogger;
}

export function createLogger(scope: string): ScopedLogger {
  return {
    info: (msg, extra) => emit('INFO', scope, msg, extra),
    warn: (msg, extra) => emit('WARN', scope, msg, extra),
    error: (msg, extra) => emit('ERROR', scope, msg, extra),
    with: (subscope) => createLogger(`${scope}.${subscope}`)
  };
}

// Compatibility default — `log.knowledge.with('preprocess')`, `log.tasks.with('mutate')`, etc.
export const log = {
  info: (msg: string, extra?: unknown) => emit('INFO', 'kevin', msg, extra),
  warn: (msg: string, extra?: unknown) => emit('WARN', 'kevin', msg, extra),
  error: (msg: string, extra?: unknown) => emit('ERROR', 'kevin', msg, extra),
  knowledge: createLogger('knowledge'),
  tasks: createLogger('tasks'),
  session: createLogger('session'),
  mcp: createLogger('mcp')
};
