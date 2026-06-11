/**
 * Pure string formatters shared by the status renderers (ANSI TUI + HTML
 * dashboard). No ANSI, no markup — plain text in, plain text out.
 */
import { homedir } from 'node:os';

/** Collapse the OS home prefix to `~` for display. */
export const tildifyHome = (path: string): string => {
  const home = homedir();
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};

export const humanBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Coarse relative time from an ISO timestamp — `just now`, `5m ago`, `3d ago`. */
export const relTime = (iso: string | null): string => {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 36) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Strip the `mcp__<server>__` prefix MCP adds, leaving the bare tool name. */
export const shortToolName = (name: string): string => {
  const idx = name.lastIndexOf('__');
  return idx >= 0 ? name.slice(idx + 2) : name;
};
