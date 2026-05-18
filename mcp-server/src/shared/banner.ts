/**
 * ASCII banner for the SessionStart hook.
 *
 * Colors wrap each line individually: Claude Code's systemMessage renderer
 * resets ANSI state at every newline, so a single open/close around the
 * whole block would only color line 1.
 */

const ESC = '\x1b[';
const YELLOW_BOLD = `${ESC}1m${ESC}33m`;
const CYAN_BOLD = `${ESC}1m${ESC}36m`;
const RESET = `${ESC}0m`;

const AGENT_LINES = [' ╔═╗ ╔═╗ ╔═╗ ╔╗╔ ╔╦╗', ' ╠═╣ ║ ╦ ║╣  ║║║  ║ ', ' ╩ ╩ ╚═╝ ╚═╝ ╝╚╝  ╩ '] as const;
const KEVIN = '===KEVIN=== 🍌';

const colorize = (text: string, color: string): string => `${color}${text}${RESET}`;

export const AGENT_KEVIN_BANNER = [
  ...AGENT_LINES.map((line) => colorize(line, YELLOW_BOLD)),
  colorize(KEVIN, CYAN_BOLD)
].join('\n');
