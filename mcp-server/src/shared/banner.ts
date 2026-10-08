/**
 * ASCII banner for the SessionStart hook.
 *
 * Colors wrap each line individually: Claude Code's systemMessage renderer
 * resets ANSI state at every newline, so a single open/close around the
 * whole block would only color line 1.
 */

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

/** Raw (uncolored) wordmark lines + tagline. Exported so other surfaces (e.g.
 *  the `status` screen) can re-colorize them under their own color policy
 *  without inheriting this module's hardcoded SessionStart palette. */
export const BANNER_LINES = [' ╔═╗ ╔═╗ ╔═╗ ╔╗╔ ╔╦╗', ' ╠═╣ ║ ╦ ║╣  ║║║  ║ ', ' ╩ ╩ ╚═╝ ╚═╝ ╝╚╝  ╩ '] as const;
export const BANNER_TAG = '===KEVIN=== 🍌';

export const ANSI = {
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  yellow: `${ESC}33m`,
  cyan: `${ESC}36m`
} as const;

/**
 * One colored fragment, reset at its end so fragments compose within a line.
 */
export const paint = (text: string, ...codes: string[]): string =>
  codes.length ? `${codes.join('')}${text}${RESET}` : text;

export const BANNER = [
  ...BANNER_LINES.map((line) => paint(line, ANSI.bold, ANSI.yellow)),
  paint(BANNER_TAG, ANSI.bold, ANSI.cyan)
].join('\n');

// Codex's ratatui renderer prints escapes as raw bytes, and log files read better without them.
export const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
