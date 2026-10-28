/**
 * The two-line footer a Claude Code session shows from an agent home.
 *
 * Line one: model with its effort level, folder (a `file://` link), git branch. Line two: a context bar with the
 * percentage, session cost with the hourly rate, elapsed time, and the Pro/Max rate-limit
 * windows with the time until each resets, when the host reports them. Pure given `now`: the
 * payload is Claude Code's status-line JSON and the branch is looked up by the caller.
 *
 * Ported from the bash status line in trailofbits/claude-code-config
 * (https://github.com/trailofbits/claude-code-config), credit to Trail of Bits.
 */
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface StatusLinePayload {
  model?: { display_name?: string };
  effort?: { level?: string };
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
  rate_limits?: { five_hour?: RateLimitWindow; seven_day?: RateLimitWindow };
}

interface RateLimitWindow {
  used_percentage?: number;
  /** Unix epoch seconds. */
  resets_at?: number;
}

export type Theme = 'dark' | 'light';

export interface StatusLineOptions {
  /** The current git branch, empty or absent outside a repository. */
  branch?: string;
  /** Leads line one; the agent's own emoji when the home names one. */
  emoji?: string;
  /** The terminal's appearance; dark when unknown. */
  theme?: Theme;
  /** Epoch milliseconds the reset countdowns count from. */
  now?: number;
}

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const WHITE = `${ESC}37m`;
const DEFAULT_FOREGROUND = `${ESC}39m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const BLUE = `${ESC}34m`;
const CYAN = `${ESC}36m`;
const BRIGHT_BLUE = `${ESC}94m`;
const BRIGHT_CYAN = `${ESC}96m`;

interface Palette {
  text: string;
  folder: string;
  branch: string;
}

/** White and the bright hues wash out on a light background; the rest read on both. */
export const PALETTES: Record<Theme, Palette> = {
  dark: { text: WHITE, folder: BRIGHT_BLUE, branch: BRIGHT_CYAN },
  light: { text: DEFAULT_FOREGROUND, folder: BLUE, branch: CYAN }
};
const SEP = `${DIM}│${RESET}`;
const BAR_WIDTH = 12;

const paint = (color: string, text: string): string => `${color}${text}${RESET}`;

/** Green under half, yellow to 79%, red from 80%: the same scale for context and rate limits. */
const usageColor = (percent: number): string => (percent < 50 ? GREEN : percent < 80 ? YELLOW : RED);

export const contextBar = (percent: number, width = BAR_WIDTH): string => {
  const filled = percent > 0 ? Math.max(1, Math.floor((percent * width) / 100)) : 0;
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

/** Time left until a rate-limit window resets: minutes under an hour, then the nearest hour, then the nearest day. */
export const formatCountdown = (remainingMs: number): string => {
  if (remainingMs < 3_600_000) {
    return `${Math.max(0, Math.floor(remainingMs / 60_000))}m`;
  }
  const hours = Math.round(remainingMs / 3_600_000);
  return hours < 24 ? `${hours}h` : `${Math.round(remainingMs / 86_400_000)}d`;
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
  const palette = PALETTES[options.theme ?? 'dark'];

  const effort = payload.effort?.level ? ` ${paint(DIM, payload.effort.level)}` : '';

  const first = [
    `${options.emoji ?? '🤖'} ${paint(palette.text, model)}${effort}`,
    paint(palette.folder, `📁 ${folderLink(dir)}`),
    ...(options.branch ? [paint(palette.branch, `🌿 ${options.branch}`)] : [])
  ];

  const usage = context === null ? [] : [`${contextBar(context)} ${paint(palette.text, `${context}%`)}`];
  const hourly = durationMs > 0 ? ` ${paint(DIM, `($${((cost / (durationMs / 1000)) * 3600).toFixed(2)}/hr)`)}` : '';
  const now = options.now ?? Date.now();
  const limit = (label: string, window: RateLimitWindow | undefined): string[] => {
    const used = percentOrNull(window?.used_percentage);
    if (used === null) {
      return [];
    }
    const resetsAt = window?.resets_at;
    const text =
      typeof resetsAt === 'number' ? `${used}% ↻ ${formatCountdown(resetsAt * 1000 - now)}` : `${label} ${used}%`;
    return [paint(usageColor(used), text)];
  };
  const limits = [...limit('5h', payload.rate_limits?.five_hour), ...limit('7d', payload.rate_limits?.seven_day)];
  const second = [
    ...usage,
    `${paint(YELLOW, `$${cost.toFixed(2)}`)}${hourly}`,
    ...(durationMs > 0 ? [paint(CYAN, `⏱ ${formatDuration(durationMs)}`)] : []),
    ...(limits.length > 0 ? [`⏳ ${limits.join(' · ')}`] : [])
  ];

  return `${first.join(` ${SEP} `)}\n\n${second.join(` ${SEP} `)}`;
};
