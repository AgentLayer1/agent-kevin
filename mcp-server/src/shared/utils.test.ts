import { describe, expect, test } from 'bun:test';
import { inChunks } from './utils';

describe('inChunks', () => {
  test('keeps the order and never runs more than the chunk size at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await inChunks([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await Bun.sleep(1);
      running -= 1;
      return item * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBe(3);
    expect(await inChunks([], 3, async (item: number) => item)).toEqual([]);
  });
});
