/**
 * The `statusLine` entry a home's Claude settings carry, and the check that its command still
 * names the plugin that is running. Claude Code offers no plugin-level status line and no
 * `${CLAUDE_PLUGIN_ROOT}` in settings, so the command pins the checkout; a version-pinned
 * plugin cache moves on every release, and a stale path leaves the footer blank with nothing
 * on screen saying why.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export interface StatusLineSetting {
  type: 'command';
  command: string;
}

/** Double quotes are the one quoting sh and PowerShell agree on; a path either shell would expand inside them is refused. */
const quote = (value: string): string => {
  if (/["$`]/.test(value)) {
    throw new Error(`${value}: the status line command may not contain ", $, or a backtick`);
  }
  return `"${value}"`;
};

/** Forward slashes on every platform: Git Bash on Windows eats the backslashes in a settings command. */
export const statusLineSetting = (binPath: string): StatusLineSetting => ({
  type: 'command',
  command: `bun ${quote(binPath.replaceAll('\\', '/'))} statusline`
});

/** The path a command of ours points at, when it is ours (`bun "<root>/bin/<agent>" statusline`). */
export const commandBinPath = (command: string, agent: string): string | undefined => {
  const name = agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^bun "?(.+?[\\\\/]bin[\\\\/]${name})"? statusline(?:\\s|$)`).exec(command.trim());
  return match?.[1];
};

/** Symlink-free, so a checkout reached through a link never reads as a different plugin. */
const canonical = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/**
 * Why the home's status line will not render from this checkout, or nothing when it is
 * absent, the operator's own, or already current.
 */
export const statusLineDrift = (settingsPath: string, binPath: string): string | undefined => {
  if (!existsSync(settingsPath)) return undefined;
  let command: unknown;
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    command = (parsed as { statusLine?: { command?: unknown } } | null)?.statusLine?.command;
  } catch {
    return undefined; // a settings file Claude Code itself could not parse is not this check's problem
  }
  if (typeof command !== 'string') return undefined;
  const pinned = commandBinPath(command, basename(binPath));
  if (pinned === undefined || canonical(pinned) === canonical(binPath)) return undefined;
  return `\`.claude/settings.json\` runs the status line from \`${pinned}\`, not this plugin (\`${resolve(binPath)}\`), so the footer stays blank — run \`/agent-kevin:upgrade\` to re-point it`;
};
