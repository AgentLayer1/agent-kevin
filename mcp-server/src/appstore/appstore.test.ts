import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { feed, feedUrl, parseAppId, parseFeed } from './feed';
import { resolveSource, summarize } from './sources';
import type { AppStoreReview, ReviewSource, StorefrontCoverage } from './types';

const APP = '1234567890';

const metadata = { 'im:name': { label: 'Acme Notes' }, id: { label: 'https://apps.apple.com/us/app/acme-notes/id1234567890' } };

const entry = (id: number, date: string, rating = 5) => ({
  author: { name: { label: 'Ada' } },
  updated: { label: date },
  'im:rating': { label: String(rating) },
  'im:version': { label: '2.1.0' },
  id: { label: String(id) },
  title: { label: `Review ${id}` },
  content: { label: `Text ${id}` }
});

const page = (entries: unknown[] | unknown) => JSON.stringify({ feed: { entry: entries } });
const blank = JSON.stringify({ feed: { title: { label: 'Customer Reviews' } } });

/** `count` reviews, one a day back from `start`. */
const reviewsFrom = (first: number, count: number, start: string) =>
  Array.from({ length: count }, (_, i) => entry(first + i, new Date(Date.parse(start) - i * 86_400_000).toISOString()));

describe('parseAppId', () => {
  test('takes a link, idN or the bare number', () => {
    expect(parseAppId('1234567890')).toBe(APP);
    expect(parseAppId('id1234567890')).toBe(APP);
    expect(parseAppId('https://apps.apple.com/us/app/acme-notes/id1234567890?l=en')).toBe(APP);
  });

  test('refuses anything without an id', () => {
    expect(() => parseAppId('acme')).toThrow(/App Store link/);
    expect(() => parseAppId('https://apps.apple.com/us/app/acme-notes')).toThrow(/App Store link/);
  });
});

describe('parseFeed', () => {
  test('skips the app metadata entry and maps each review', () => {
    const parsed = parseFeed(page([metadata, entry(1, '2026-10-01T08:00:00-07:00', 4)]), 'gb');
    expect(parsed).toEqual({
      state: 'ok',
      reviews: [{ id: '1', storefront: 'gb', rating: 4, title: 'Review 1', text: 'Text 1', author: 'Ada', version: '2.1.0', date: '2026-10-01T08:00:00-07:00' }]
    });
  });

  test('a single entry arrives as an object, not a list', () => {
    const parsed = parseFeed(page(entry(7, '2026-10-01T08:00:00Z')), 'us');
    expect(parsed.state === 'ok' && parsed.reviews.map((review) => review.id)).toEqual(['7']);
  });

  test('content given as a list takes the plain-text item', () => {
    const review = { ...entry(2, '2026-10-01T08:00:00Z'), content: [{ label: '<b>Html</b>', attributes: { type: 'html' } }, { label: 'Plain', attributes: { type: 'text' } }] };
    const parsed = parseFeed(page([review]), 'us');
    expect(parsed.state === 'ok' && parsed.reviews[0]?.text).toBe('Plain');
  });

  test('no entry, or no feed, is blank; non-JSON throws', () => {
    expect(parseFeed(blank, 'us')).toEqual({ state: 'blank' });
    expect(parseFeed('{}', 'us')).toEqual({ state: 'blank' });
    expect(() => parseFeed('<html>', 'us')).toThrow();
  });
});

describe('feed adapter', () => {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  let respond: (url: string) => Response = () => new Response(blank);
  let inFlight = 0;
  let peak = 0;

  beforeEach(() => {
    asked.length = 0;
    inFlight = 0;
    peak = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((done) => setTimeout(done, 1));
      inFlight -= 1;
      return respond(url);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const pageOf = (url: string): number => Number(/page=(\d+)/.exec(url)?.[1]);

  test('stops paging once reviews pass the cutoff', async () => {
    respond = (url) => new Response(page(reviewsFrom(pageOf(url) * 100, 50, `2026-10-${21 - pageOf(url)}T00:00:00Z`)));
    const cutoff = Date.parse('2026-09-25T00:00:00Z');
    const batch = await feed.reviews({ app: APP, storefronts: ['us'], cutoff });
    expect(asked.map(pageOf)).toEqual([1]);
    expect(batch.coverage[0]).toMatchObject({ state: 'ok', stop: 'since' });
    expect(batch.reviews.every((review) => Date.parse(review.date) >= cutoff)).toBe(true);
  });

  test('a short page ends the storefront, and ten full pages hit the cap', async () => {
    respond = () => new Response(page(reviewsFrom(1, 12, '2026-10-20T00:00:00Z')));
    expect((await feed.reviews({ app: APP, storefronts: ['us'] })).coverage[0]).toMatchObject({ state: 'ok', stop: 'end', reviews: 12 });
    asked.length = 0;
    respond = (url) => new Response(page(reviewsFrom(pageOf(url) * 100, 50, '2026-10-20T00:00:00Z')));
    const capped = await feed.reviews({ app: APP, storefronts: ['us'] });
    expect(asked.length).toBe(10);
    expect(capped.coverage[0]).toMatchObject({ state: 'ok', stop: 'cap', reviews: 500 });
  });

  test("a blank page is asked again at the ?cc= address before it counts", async () => {
    respond = (url) => new Response(url.includes('?cc=') ? page(reviewsFrom(1, 3, '2026-10-20T00:00:00Z')) : blank);
    const batch = await feed.reviews({ app: APP, storefronts: ['gb'] });
    expect(asked).toEqual([feedUrl('gb', APP, 1), feedUrl('gb', APP, 1, true)]);
    expect(batch.coverage[0]).toMatchObject({ state: 'ok', reviews: 3 });
  });

  test('blank at both addresses is blank; a failure is an error that keeps what was read', async () => {
    respond = () => new Response(blank);
    expect((await feed.reviews({ app: APP, storefronts: ['us'] })).coverage[0]).toEqual({ storefront: 'us', state: 'blank', reviews: 0 });
    respond = (url) => (pageOf(url) === 1 ? new Response(page(reviewsFrom(1, 50, '2026-10-20T00:00:00Z'))) : new Response('down', { status: 503 }));
    const failed = await feed.reviews({ app: APP, storefronts: ['us'] });
    expect(failed.coverage[0]).toMatchObject({ state: 'error', reviews: 50, error: 'HTTP 503' });
    expect(failed.reviews.length).toBe(50);
  });

  test('reads a few storefronts at a time', async () => {
    respond = () => new Response(page(reviewsFrom(1, 2, '2026-10-20T00:00:00Z')));
    const storefronts = ['us', 'gb', 'ca', 'au', 'de', 'fr', 'jp', 'my', 'sa'];
    const batch = await feed.reviews({ app: APP, storefronts });
    expect(batch.coverage.map((entry) => entry.storefront)).toEqual(storefronts);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

const review = (id: string, rating: number, date: string, storefront = 'us'): AppStoreReview => ({
  id,
  storefront,
  rating,
  title: '',
  text: '',
  author: 'Ada',
  date
});

const covered = (storefront: string, state: StorefrontCoverage['state'], reviews = 0, extra: Partial<StorefrontCoverage> = {}): StorefrontCoverage => ({
  storefront,
  state,
  reviews,
  ...extra
});

describe('summarize', () => {
  test('dedupes, sorts newest first, counts ratings before filtering, then limits', () => {
    const batch = {
      reviews: [review('a', 5, '2026-10-01T00:00:00Z'), review('b', 1, '2026-10-03T00:00:00Z', 'gb'), review('a', 5, '2026-10-01T00:00:00Z'), review('c', 2, '2026-10-02T00:00:00Z')],
      coverage: [covered('us', 'ok', 2), covered('gb', 'ok', 1)]
    };
    const summary = summarize(batch, { maxRating: 3, limit: 1 }, false);
    expect(summary.ratings).toEqual({ '1': 1, '2': 1, '3': 0, '4': 0, '5': 1 });
    expect(summary.total).toBe(3);
    expect(summary.reviews?.map((item) => item.id)).toEqual(['b']);
    expect(summary.returned).toBe(1);
    expect(summary.complete).toBe(true);
  });

  test('nothing read is a blank feed: a warning and no counts, never zero', () => {
    const summary = summarize({ reviews: [], coverage: [covered('us', 'blank'), covered('gb', 'blank')] }, { limit: 100 }, false);
    expect(summary.complete).toBe(false);
    expect(summary.total).toBeUndefined();
    expect(summary.ratings).toBeUndefined();
    expect(summary.warnings.join(' ')).toMatch(/not zero reviews/);
  });

  test('blank storefronts beside ones with reviews are counted, or named when the caller named them', () => {
    const batch = { reviews: [review('a', 4, '2026-10-01T00:00:00Z')], coverage: [covered('us', 'ok', 1), covered('gb', 'blank'), covered('ca', 'blank')] };
    const swept = summarize(batch, { limit: 100 }, false);
    expect(swept.coverage.blank).toBe(2);
    expect(swept.warnings).toEqual([]);
    expect(summarize(batch, { limit: 100 }, true).coverage.blank).toEqual(['gb', 'ca']);
  });

  test('errors and caps are always named', () => {
    const batch = { reviews: [], coverage: [covered('us', 'ok', 500, { stop: 'cap' }), covered('gb', 'error', 0, { error: 'HTTP 503' })] };
    const summary = summarize(batch, { limit: 100 }, false);
    expect(summary.complete).toBe(false);
    expect(summary.coverage.errors).toEqual([{ storefront: 'gb', error: 'HTTP 503' }]);
    expect(summary.warnings.join(' ')).toMatch(/gb \(HTTP 503\)/);
    expect(summary.warnings.join(' ')).toMatch(/us reached/);
  });
});

describe('resolveSource', () => {
  const fake = (configured: boolean): ReviewSource => ({
    name: 'feed',
    keys: ['ACME_KEY'],
    configured: () => configured,
    reviews: async () => ({ reviews: [], coverage: [] })
  });

  test('picks the first configured source, or the one named', () => {
    expect(resolveSource(undefined, { feed: fake(true) }).name).toBe('feed');
    expect(resolveSource('feed', { feed: fake(true) }).name).toBe('feed');
  });

  test('refuses a source that is not set up, naming its keys', () => {
    expect(() => resolveSource('feed', { feed: fake(false) })).toThrow(/ACME_KEY/);
    expect(() => resolveSource(undefined, { feed: fake(false) })).toThrow(/isn't set up/);
  });
});
