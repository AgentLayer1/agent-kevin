import { describe, expect, test } from 'bun:test';
import { readStats, STOREFRONTS } from '@/appstore/storefronts';
import type { ReviewQuery, ReviewSource } from '@/appstore/types';
import { cutoffOf, readReviews } from './appstore';

const NOW = new Date('2026-10-21T00:00:00Z');

/** A stand-in adapter: proves the tool needs nothing from a source beyond the interface. */
const fakeSource = (answer: (query: ReviewQuery) => ReturnType<ReviewSource['reviews']>): ReviewSource & { asked: ReviewQuery[] } => {
  const asked: ReviewQuery[] = [];
  return {
    name: 'feed',
    keys: [],
    configured: () => true,
    asked,
    reviews: async (query) => {
      asked.push(query);
      return answer(query);
    }
  };
};

const parse = (output: string): Record<string, unknown> => {
  expect(output.startsWith('<untrusted-source label="appstore:')).toBe(true);
  return JSON.parse(output.slice(output.indexOf('\n') + 1, output.lastIndexOf('\n')));
};

describe('cutoffOf', () => {
  test('takes a window, any, or an ISO date', () => {
    expect(cutoffOf('7d', NOW)).toBe(Date.parse('2026-10-14T00:00:00Z'));
    expect(cutoffOf('any', NOW)).toBeUndefined();
    expect(cutoffOf('2026-10-01T00:00:00Z', NOW)).toBe(Date.parse('2026-10-01T00:00:00Z'));
    expect(() => cutoffOf('last week', NOW)).toThrow(/since takes/);
  });
});

describe('readReviews', () => {
  test('runs end to end on any source and reports what it read', async () => {
    const source = fakeSource(async ({ storefronts }) => ({
      reviews: [{ id: 'r1', storefront: 'us', rating: 2, title: 'Sync broke', text: 'Since 2.1', author: 'Ada', version: '2.1.0', date: '2026-10-20T00:00:00Z' }],
      coverage: storefronts.map((storefront) => ({ storefront, state: storefront === 'us' ? ('ok' as const) : ('blank' as const), reviews: storefront === 'us' ? 1 : 0 }))
    }));
    const result = parse(await readReviews({ app: 'https://apps.apple.com/us/app/acme-notes/id1234567891' }, source, NOW));
    expect(source.asked[0]?.storefronts).toEqual([...STOREFRONTS]);
    expect(result).toMatchObject({ source: 'feed', app: '1234567891', since: '30d', through: NOW.toISOString(), total: 1, complete: true });
    expect(result.plan).toMatchObject({ read: 'every storefront', storefronts: STOREFRONTS.length });
    expect(readStats('1234567891')?.storefronts.us?.reviews).toBe(1);

    const second = parse(await readReviews({ app: '1234567891' }, source, NOW));
    expect(second.plan).toMatchObject({ read: 'learned', active: 1, discovery: 15 });
    expect(source.asked[1]?.storefronts[0]).toBe('us');
  });

  test('named storefronts are checked and read as given', async () => {
    const source = fakeSource(async ({ storefronts }) => ({ reviews: [], coverage: storefronts.map((storefront) => ({ storefront, state: 'blank' as const, reviews: 0 })) }));
    const result = parse(await readReviews({ app: '1234567892', storefronts: ['GB', 'my'], since: '2026-10-01T00:00:00Z' }, source, NOW));
    expect(source.asked[0]).toEqual({ app: '1234567892', storefronts: ['gb', 'my'], cutoff: Date.parse('2026-10-01T00:00:00Z') });
    expect(result.total).toBeUndefined();
    await expect(readReviews({ app: '1234567892', storefronts: ['zz'] }, source, NOW)).rejects.toThrow(/Not App Store storefronts: zz/);
  });
});
