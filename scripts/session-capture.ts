#!/usr/bin/env bun
/**
 * SessionEnd / PreCompact hook — extracts transcript turns and appends to
 * today's session log under `<HOME>/knowledge/raw/sessions/YYYY-MM-DD.md`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { FOLDERS, isInitialized } from '../mcp-server/src/config';
import { ENTRY_SEPARATOR } from '../mcp-server/src/knowledge/session-format';
import { extractConversationContext } from '../mcp-server/src/knowledge/utils';
import { nowTime, todayDate } from '../mcp-server/src/shared/utils';

interface Mode {
  heading: string;
  minTurns: number;
  event?: 'PreCompact';
}

const MODES: Record<string, Mode> = {
  'session-end': { heading: 'Session', minTurns: 1 },
  'pre-compact': { heading: 'Pre-Compact', minTurns: 5, event: 'PreCompact' },
};

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
}

/** True when this process is Claude Code's plugin hook invocation. */
function isPluginInvocation(): boolean {
  return Boolean(process.env.CLAUDE_PLUGIN_ROOT);
}

/**
 * Render `cwd` as `~/<relative>` when under `$HOME`, otherwise return it
 * unchanged. Falls back to `unknown` for empty input.
 */
function homeRelative(cwd: string): string {
  if (!cwd) return 'unknown';
  const home = homedir();
  if (cwd === home) return '~';
  if (cwd.startsWith(`${home}/`)) return `~/${relative(home, cwd)}`;
  return cwd;
}

/** True when the project at `cwd` enables an `agent-kevin@*` plugin. */
function pluginEnabledInCwd(cwd: string): boolean {
  if (!cwd) return false;
  const settingsPath = resolve(cwd, '.claude/settings.json');
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      enabledPlugins?: Record<string, boolean>;
    };
    return Object.entries(settings.enabledPlugins ?? {}).some(
      ([key, enabled]) => enabled === true && key.startsWith('agent-kevin@'),
    );
  } catch {
    return false;
  }
}

/**
 * Walk up from `cwd` looking for `SOUL.md` — the universal agent-home
 * marker (any agent built on Kevin's init convention writes one). Returns
 * the agent-home directory if found, else null. Stops at filesystem root.
 */
function findAgentHome(cwd: string): string | null {
  if (!cwd) return null;
  let dir = resolve(cwd);
  while (true) {
    if (existsSync(resolve(dir, 'SOUL.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * True when `cwd` lives inside another agent's home (not Kevin's). Lets
 * Kevin defer to whichever agent owns that directory tree without
 * hard-coding plugin names or paths.
 */
function isOtherAgentHome(cwd: string): boolean {
  const agentHome = findAgentHome(cwd);
  return agentHome !== null && agentHome !== FOLDERS.HOME;
}

async function readStdin(): Promise<string> {
  return new Promise((resolveFn) => {
    let data = '';
    const timer = setTimeout(() => resolveFn(data), 5_000);
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolveFn(data);
    });
  });
}

function parseHookInput(raw: string): HookInput {
  try {
    return JSON.parse(raw);
  } catch {
    const fixed = raw.replace(/(?<!\\)\\(?!["\\])/g, '\\\\');
    return JSON.parse(fixed);
  }
}

async function capture(name: string, mode: Mode): Promise<void> {
  if (!isInitialized()) {
    process.stderr.write(`[session-capture] SKIP — /agent-kevin:init not run yet\n`);
    return;
  }

  const hookInput = parseHookInput(await readStdin());
  const sessionId = hookInput.session_id ?? 'unknown';
  const transcriptPath = hookInput.transcript_path ?? '';

  const cwd = hookInput.cwd ?? '';
  if (!isPluginInvocation()) {
    if (pluginEnabledInCwd(cwd)) {
      process.stderr.write(`[session-capture] SKIP — plugin hook will capture\n`);
      return;
    }
    if (isOtherAgentHome(cwd)) {
      process.stderr.write(`[session-capture] SKIP — another agent owns ${cwd}\n`);
      return;
    }
  }

  if (!transcriptPath || !existsSync(transcriptPath)) {
    process.stderr.write(`[session-capture] SKIP — no transcript at ${transcriptPath}\n`);
    return;
  }

  const { context, turnCount } = extractConversationContext(transcriptPath);
  if (!context.trim() || turnCount < mode.minTurns) {
    process.stderr.write(`[session-capture] SKIP — ${turnCount} turns (min ${mode.minTurns})\n`);
    return;
  }

  const today = todayDate();
  const filename = `${today}.md`;
  const logPath = resolve(FOLDERS.SESSIONS, filename);

  await mkdir(FOLDERS.SESSIONS, { recursive: true });

  if (!existsSync(logPath)) {
    await writeFile(logPath, `# Session Log: ${today}\n\n`, 'utf-8');
  }

  const source = homeRelative(cwd);
  const entry = `### ${mode.heading} (${nowTime()}) [${sessionId.slice(0, 8)}] · ${source}\n\n${context}${ENTRY_SEPARATOR}`;
  await appendFile(logPath, entry, 'utf-8');

  process.stderr.write(`[session-capture] saved ${turnCount} turns -> ${filename}\n`);
  if (mode.event) {
    const systemMessage = `💾 Saved ${turnCount} turn${turnCount === 1 ? '' : 's'} to ${filename}`;
    process.stdout.write(
      JSON.stringify({ systemMessage, hookSpecificOutput: { hookEventName: mode.event } }),
    );
  }
}

function main(): void {
  if (process.env.CLAUDE_INVOKED_BY) process.exit(0);

  const name = process.argv[2];
  const mode = name ? MODES[name] : undefined;
  if (!mode) {
    process.stderr.write(
      `session-capture.ts: unknown mode "${name}". Expected: ${Object.keys(MODES).join(', ')}\n`,
    );
    process.exit(1);
  }

  capture(name, mode).catch((err) => {
    process.stderr.write(`[session-capture] fatal: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
}

main();
