import { describe, expect, test } from 'bun:test';
import { renderSlice, sliceText } from '@/knowledge/context-slices';

const lines = (n: number, width = 80): string =>
  Array.from({ length: n }, (_, i) => `line ${i + 1} `.padEnd(width, 'x')).join('\n');

describe('sliceText', () => {
  test('never exceeds the limit and cuts only on line boundaries', () => {
    const text = lines(400);
    const slices = sliceText(text, 9_500);
    expect(slices.length).toBeGreaterThan(1);
    for (const slice of slices) {
      expect(slice.length).toBeLessThanOrEqual(9_500);
      expect(slice.startsWith('line ')).toBe(true);
    }
    expect(slices.join('\n')).toBe(text);
  });

  test('an over-long line becomes its own slice rather than being dropped', () => {
    const long = 'y'.repeat(12_000);
    const slices = sliceText(`a\n${long}\nb`, 9_500);
    expect(slices).toEqual(['a', long, 'b']);
  });
});

describe('renderSlice', () => {
  const stack = lines(300);
  const count = sliceText(stack, 9_500).length;

  test('each registered entry prints its slice with a preamble; entries past the stack print nothing', () => {
    const first = renderSlice(stack, { index: 1, total: 12 });
    expect(first).toContain(`slice 1/${count}`);
    expect(first).toContain('line 1 ');
    expect(renderSlice(stack, { index: count, total: 12 })).toContain(`slice ${count}/${count}`);
    expect(renderSlice(stack, { index: count + 1, total: 12 })).toBe('');
    expect(renderSlice(stack, { index: 12, total: 12 })).toBe('');
  });

  test('when the stack outgrows the registered entries, the last entry says so instead of silently truncating', () => {
    const last = renderSlice(stack, { index: 1, total: 1 });
    expect(last).toContain('slice 1/' + count);
    expect(last).toContain(`${count - 1} more slice(s) of static context were not delivered`);
    expect(renderSlice(stack, { index: 2, total: 1 })).toBe('');
  });

  test('slices reassemble to the whole stack', () => {
    const joined = Array.from({ length: count }, (_, i) => renderSlice(stack, { index: i + 1, total: count }))
      .map((s) => s.replace(/^<!-- kevin static context[^\n]*\n\n/, '').replace(/\n$/, ''))
      .join('\n');
    expect(joined).toBe(stack);
  });
});
