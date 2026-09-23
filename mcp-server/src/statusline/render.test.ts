import { describe, expect, test } from 'bun:test';
import { contextBar, formatDuration, renderStatusLine, shortModelName, type StatusLinePayload } from './render';

const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, '');
const payload: StatusLinePayload = {
  model: { display_name: 'Claude 3.5 Opus' },
  workspace: { current_dir: '/Users/ada/Agents/Scout', project_dir: '/Users/ada/Agents/Scout' },
  cost: { total_cost_usd: 1.009, total_duration_ms: 30 * 60 * 1000 },
  context_window: { used_percentage: 25.7 }
};

describe('renderStatusLine', () => {
  test('line one carries the short model, the folder as a file link, and the branch when given', () => {
    const [first, blank, second] = renderStatusLine(payload, { branch: 'main' }).split('\n');
    expect(plain(first)).toBe('🤖 Opus │ 📁 Scout │ 🌿 main');
    expect(first).toContain('\x1b]8;;file:///Users/ada/Agents/Scout\x1b\\Scout\x1b]8;;\x1b\\');
    expect(renderStatusLine({ cwd: '/Users/ada/My Agents/Scout' })).toContain('file:///Users/ada/My%20Agents/Scout');
    expect(blank).toBe('');
    expect(plain(second)).toBe('███⣿⣿⣿⣿⣿⣿⣿⣿⣿ 25% │ $1.00 ($2.00/hr) │ ⏱ 30m 0s');
  });

  test('the effort level follows the model when the host reports one', () => {
    const first = renderStatusLine({ ...payload, effort: { level: 'high' } }).split('\n')[0];
    expect(plain(first)).toBe('🤖 Opus high │ 📁 Scout');
  });

  test('no branch, no branch segment; the agent emoji replaces the robot', () => {
    const first = renderStatusLine(payload, { emoji: '🍌' }).split('\n')[0];
    expect(plain(first)).toBe('🍌 Opus │ 📁 Scout');
  });

  test('a null percentage falls back to the input tokens over the window size, an empty bar at session start', () => {
    const fresh = renderStatusLine({
      ...payload,
      cost: { total_cost_usd: 0, total_duration_ms: 0 },
      context_window: { used_percentage: null, context_window_size: 200_000, current_usage: null }
    }).split('\n')[2];
    expect(plain(fresh)).toBe('⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿ 0% │ $0.00');
    const afterCompact = renderStatusLine({
      ...payload,
      context_window: {
        used_percentage: null,
        context_window_size: 200_000,
        current_usage: { input_tokens: 10_000, cache_creation_input_tokens: 20_000, cache_read_input_tokens: 30_000 }
      }
    }).split('\n')[2];
    expect(plain(afterCompact)).toStartWith('███⣿⣿⣿⣿⣿⣿⣿⣿⣿ 30% │');
  });

  test('no percentage and no window size drops the bar; zero duration drops the rate and the clock', () => {
    const second = renderStatusLine({
      ...payload,
      cost: { total_cost_usd: 0, total_duration_ms: 0 },
      context_window: { used_percentage: null }
    }).split('\n')[2];
    expect(plain(second)).toBe('$0.00');
  });

  test('rate-limit windows render when the host reports them, each on the usage colour scale', () => {
    const second = renderStatusLine({
      ...payload,
      rate_limits: { five_hour: { used_percentage: 23.5 }, seven_day: { used_percentage: 91 } }
    }).split('\n')[2];
    expect(plain(second)).toEndWith('│ ⏳ 5h 23% · 7d 91%');
    expect(second).toContain('\x1b[32m5h 23%');
    expect(second).toContain('\x1b[31m7d 91%');
    expect(
      plain(renderStatusLine({ ...payload, rate_limits: { seven_day: { used_percentage: 5 } } }).split('\n')[2])
    ).toEndWith('│ ⏳ 7d 5%');
  });

  test('an empty payload still renders without throwing', () => {
    expect(plain(renderStatusLine({}))).toBe('🤖 Unknown │ 📁 unknown\n\n$0.00');
  });
});

describe('contextBar', () => {
  test('fills twelve cells by percentage and colours by threshold', () => {
    expect(plain(contextBar(0))).toBe('⣿'.repeat(12));
    expect(plain(contextBar(100))).toBe('█'.repeat(12));
    expect(contextBar(49)).toStartWith('\x1b[32m');
    expect(contextBar(50)).toStartWith('\x1b[33m');
    expect(contextBar(80)).toStartWith('\x1b[31m');
  });
});

describe('shortModelName / formatDuration', () => {
  test('strips the Claude prefix with or without a version', () => {
    expect(shortModelName('Claude 3.5 Opus')).toBe('Opus');
    expect(shortModelName('Claude Opus')).toBe('Opus');
    expect(shortModelName('Fable')).toBe('Fable');
  });

  test('picks the two largest units', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_725_000)).toBe('1h 2m');
  });
});
