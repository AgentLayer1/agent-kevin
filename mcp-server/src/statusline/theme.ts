/**
 * Which palette the status line paints with. Claude Code's own theme wins when it names one,
 * since a theme that clashes with the terminal is unreadable in Claude Code itself; `auto`, or
 * no theme at all, defers to the macOS appearance, the closest signal a status line can read
 * to the terminal-background query that `auto` runs.
 */
import { resolveEnv } from '@/shared/naming';
import type { Theme } from '@/statusline/render';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CUSTOM_PREFIX = 'custom:';
const LOOKUP_TIMEOUT_MS = 1000;

const jsonString = (path: string, field: string): string | undefined => {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf-8'))?.[field];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Claude Code's theme as light or dark, read in its own precedence (local, project, user); a
 * `custom:<slug>` theme counts as its base preset. Undefined for `auto` or no theme.
 */
export const claudeTheme = (
  projectDir: string | undefined,
  configDir = resolveEnv('CLAUDE_CONFIG_DIR') ?? join(homedir(), '.claude')
): Theme | undefined => {
  const paths = [
    ...(projectDir
      ? [join(projectDir, '.claude', 'settings.local.json'), join(projectDir, '.claude', 'settings.json')]
      : []),
    join(configDir, 'settings.json')
  ];
  const name = paths.reduce<string | undefined>((found, path) => found ?? jsonString(path, 'theme'), undefined);
  const preset = name?.startsWith(CUSTOM_PREFIX)
    ? (jsonString(join(configDir, 'themes', `${name.slice(CUSTOM_PREFIX.length)}.json`), 'base') ?? 'dark')
    : name;
  if (preset?.startsWith('light')) return 'light';
  if (preset?.startsWith('dark')) return 'dark';
  return undefined;
};

/** The macOS appearance: the key exists only in dark mode, so `defaults` exits 1 in light. */
const systemTheme = (): Theme => {
  if (process.platform !== 'darwin') return 'dark';
  const proc = spawnSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], { timeout: LOOKUP_TIMEOUT_MS });
  return proc.status === 1 ? 'light' : 'dark';
};

export const terminalTheme = (projectDir: string | undefined): Theme => claudeTheme(projectDir) ?? systemTheme();
