import { describe, expect, test } from 'bun:test';
import { planStorefronts, readStats, STOREFRONTS, updateStats, writeStats, type AppStats } from './storefronts';
import type { AppStoreReview, StorefrontCoverage } from './types';

const NOW = new Date('2026-10-21T00:00:00Z');
const DAYS = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const review = (id: string, storefront: string, date: string): AppStoreReview => ({ id, storefront, rating: 5, title: '', text: '', author: 'Ada', date });
const ok = (storefront: string, reviews: number): StorefrontCoverage => ({ storefront, state: 'ok', reviews });
const blank = (storefront: string): StorefrontCoverage => ({ storefront, state: 'blank', reviews: 0 });

describe('STOREFRONTS', () => {
  test('starts with US, holds each code once', () => {
    expect(STOREFRONTS[0]).toBe('us');
    expect(new Set(STOREFRONTS).size).toBe(STOREFRONTS.length);
    expect(STOREFRONTS.every((code) => /^[a-z]{2}$/.test(code))).toBe(true);
  });
});

describe('planStorefronts', () => {
  test('nothing known, or a month since the last full sweep, reads every storefront US first', () => {
    expect(planStorefronts(undefined, NOW)).toMatchObject({ full: true, storefronts: [...STOREFRONTS] });
    expect(planStorefronts({ lastFullSweep: DAYS(31), storefronts: { gb: { reviews: 3 } } }, NOW).full).toBe(true);
  });

  test('otherwise the active storefronts, US first then by reviews, plus fifteen to discover', () => {
    const stats: AppStats = {
      lastFullSweep: DAYS(3),
      storefronts: { gb: { reviews: 9 }, my: { reviews: 20 }, us: { reviews: 2 }, fr: { reviews: 0, lastChecked: DAYS(1) } }
    };
    const plan = planStorefronts(stats, NOW);
    expect(plan.full).toBe(false);
    expect(plan.storefronts.slice(0, 3)).toEqual(['us', 'my', 'gb']);
    expect(plan.active).toBe(3);
    expect(plan.discovery).toBe(15);
    expect(plan.storefronts).toHaveLength(18);
  });

  test('discovery visits the least recently checked storefronts first', () => {
    const stats: AppStats = {
      lastFullSweep: DAYS(3),
      storefronts: Object.fromEntries(STOREFRONTS.map((code, i) => [code, { reviews: 0, lastChecked: DAYS(i % 2 === 0 ? 1 : 10) }]))
    };
    const plan = planStorefronts(stats, NOW);
    expect(plan.active).toBe(0);
    expect(plan.storefronts.every((code) => STOREFRONTS.indexOf(code) % 2 === 1)).toBe(true);
  });
});

describe('updateStats', () => {
  test('counts each review once, keeps the newest date, stamps what answered', () => {
    const first = updateStats(undefined, [ok('us', 2), blank('gb')], [review('a', 'us', DAYS(5)), review('b', 'us', DAYS(2))], { full: true, now: NOW });
    expect(first.lastFullSweep).toBe(NOW.toISOString());
    expect(first.storefronts.us).toEqual({ reviews: 2, lastReviewAt: DAYS(2), lastChecked: NOW.toISOString() });
    expect(first.storefronts.gb).toEqual({ reviews: 0, lastChecked: NOW.toISOString() });
    const again = updateStats(first, [ok('us', 3)], [review('a', 'us', DAYS(5)), review('b', 'us', DAYS(2)), review('c', 'us', DAYS(1))], { full: false, now: NOW });
    expect(again.storefronts.us?.reviews).toBe(3);
    expect(again.lastFullSweep).toBe(NOW.toISOString());
  });

  test('a read where nothing came back changes nothing', () => {
    const before: AppStats = { lastFullSweep: DAYS(3), storefronts: { us: { reviews: 4, lastChecked: DAYS(3) } } };
    expect(updateStats(before, [blank('us'), { storefront: 'gb', state: 'error', reviews: 0, error: 'HTTP 503' }], [], { full: true, now: NOW })).toBe(before);
  });

  test('round-trips through the home', () => {
    const stats: AppStats = { lastFullSweep: DAYS(1), storefronts: { us: { reviews: 1, lastReviewAt: DAYS(1), lastChecked: DAYS(1) } } };
    writeStats('1234567890', stats);
    expect(readStats('1234567890')).toEqual(stats);
    expect(readStats('999')).toBeUndefined();
  });
});
