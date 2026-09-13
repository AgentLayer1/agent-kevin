/**
 * The two-line footer a Claude Code session shows from an agent home.
 *
 * Line one: model, folder (a `file://` link), git branch. Line two: a context bar with the
 * percentage, session cost with the hourly rate, elapsed time, and the Pro/Max rate-limit
 * windows when the host reports them. Pure: the payload is Claude Code's status-line JSON
 * and the branch is looked up by the caller.
 *
 * Ported from the bash status line in trailofbits/claude-code-config
 * (https://github.com/trailofbits/claude-code-config), credit to Trail of Bits.
 */
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface StatusLinePayload {
  model?: { display_name?: string };
  cwd?: string;
  workspace?: { current_dir?: string; project_dir?: string };
  cost?: { total_cost_usd?: number; total_duration_ms?: number };
  context_window?: {
    used_percentage?: number | null;
    context_window_size?: number;
    current_usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
  };
  rate_limits?: { five_hour?: { used_percentage?: number }; seven_day?: { used_percentage?: number } };
}

export interface StatusLineOptions {
  /** The current git branch, empty or absent outside a repository. */
  branch?: string;
  /** Leads line one; the agent's own emoji when the home names one. */
  emoji?: string;
}

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const WHITE = `${ESC}37m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const CYAN = `${ESC}36m`;
const BRIGHT_BLUE = `${ESC}94m`;
const BRIGHT_CYAN = `${ESC}96m`;
const SEP = `${DIM}│${RESET}`;
const BAR_WIDTH = 12;

const paint = (color: string, text: string): string => `${color}${text}${RESET}`;

/** Green under half, yellow to 79%, red from 80%: the same scale for context and rate limits. */
const usageColor = (percent: number): string => (percent < 50 ? GREEN : percent < 80 ? YELLOW : RED);

export const contextBar = (percent: number, width = BAR_WIDTH): string => {
  const filled = Math.floor((percent * width) / 100);
  return `${usageColor(percent)}${'█'.repeat(filled)}${DIM}${'⣿'.repeat(width - filled)}${RESET}`;
};

/** "Claude 3.5 Opus" and "Claude Opus" both read as "Opus". */
export const shortModelName = (name: string): string => name.replace(/Claude [0-9.]+ /, '').replace(/^Claude /, '');

export const formatDuration = (durationMs: number): string => {
  const total = Math.floor(durationMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const percentOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;

/**
 * The host's own percentage when it has one; before the first response and after a compact it
 * is null, so the input tokens over the window size stand in (an empty bar at 0%, not no bar).
 */
const contextPercent = (window: StatusLinePayload['context_window']): number | null => {
  const reported = percentOrNull(window?.used_percentage);
  if (reported !== null) return reported;
  const size = window?.context_window_size ?? 0;
  if (size <= 0) return null;
  const usage = window?.current_usage;
  const input =
    (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
  return Math.floor((input * 100) / size);
};

const folderLink = (dir: string): string =>
  `\x1b]8;;${pathToFileURL(dir).href}\x1b\\${basename(dir) || dir}\x1b]8;;\x1b\\`;

export const renderStatusLine = (payload: StatusLinePayload, options: StatusLineOptions = {}): string => {
  const dir = payload.workspace?.current_dir ?? payload.cwd ?? 'unknown';
  const model = shortModelName(payload.model?.display_name ?? 'Unknown');
  const cost = Math.floor((payload.cost?.total_cost_usd ?? 0) * 100) / 100;
  const durationMs = payload.cost?.total_duration_ms ?? 0;
  const context = contextPercent(payload.context_window);
  const fiveHour = percentOrNull(payload.rate_limits?.five_hour?.used_percentage);
  const sevenDay = percentOrNull(payload.rate_limits?.seven_day?.used_percentage);

  const first = [
    `${options.emoji ?? '🤖'} ${paint(WHITE, model)}`,
    paint(BRIGHT_BLUE, `📁 ${folderLink(dir)}`),
    ...(options.branch ? [paint(BRIGHT_CYAN, `🌿 ${options.branch}`)] : [])
  ];

  const usage = context === null ? [] : [`${contextBar(context)} ${paint(WHITE, `${context}%`)}`];
  const hourly = durationMs > 0 ? ` ${paint(DIM, `($${((cost / (durationMs / 1000)) * 3600).toFixed(2)}/hr)`)}` : '';
  const limits = [
    ...(fiveHour === null ? [] : [paint(usageColor(fiveHour), `5h ${fiveHour}%`)]),
    ...(sevenDay === null ? [] : [paint(usageColor(sevenDay), `7d ${sevenDay}%`)])
  ];
  const second = [
    ...usage,
    `${paint(YELLOW, `$${cost.toFixed(2)}`)}${hourly}`,
    ...(durationMs > 0 ? [paint(CYAN, `⏱ ${formatDuration(durationMs)}`)] : []),
    ...(limits.length > 0 ? [`⏳ ${limits.join(' · ')}`] : [])
  ];

  return `${first.join(` ${SEP} `)}\n\n${second.join(` ${SEP} `)}`;
};
