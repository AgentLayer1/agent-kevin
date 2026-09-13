import { describe, expect, test } from 'bun:test';
import { renderSubagentRow, renderSubagentRows } from './subagent';

const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('renderSubagentRow', () => {
  test('shows the context used as a bar and percentage when the window size is known', () => {
    const row = renderSubagentRow({
      id: 't1',
      name: 'Explore',
      description: 'map the repo',
      tokenCount: 50_000,
      contextWindowSize: 200_000
    });
    expect(plain(row)).toBe('Explore · map the repo · ██⣿⣿⣿⣿⣿⣿ 25%');
  });

  test('falls back to a token count without a window size, and to the id without a name', () => {
    expect(plain(renderSubagentRow({ id: 't2', description: 'review', tokenCount: 12_345 }))).toBe(
      't2 · review · 12.3k tok'
    );
    expect(plain(renderSubagentRow({ id: 't3', name: 'Plan' }))).toBe('Plan');
  });

  test('truncates the description to the row width, never the usage', () => {
    const row = renderSubagentRow(
      {
        id: 't4',
        name: 'Explore',
        description: 'a description that runs well past the panel',
        tokenCount: 1000,
        contextWindowSize: 100_000
      },
      40
    );
    expect(plain(row)).toBe('Explore · a description t… · ⣿⣿⣿⣿⣿⣿⣿⣿ 1%');
    expect(plain(row).length).toBeLessThanOrEqual(40);
  });
});

describe('renderSubagentRows', () => {
  test('emits one JSON line per task', () => {
    const out = renderSubagentRows({
      columns: 80,
      tasks: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B', tokenCount: 10 }
      ]
    });
    expect(out.split('\n').map((line) => JSON.parse(line))).toEqual([
      { id: 'a', content: 'A' },
      { id: 'b', content: expect.stringContaining('B · ') }
    ]);
    expect(renderSubagentRows({})).toBe('');
  });
});
