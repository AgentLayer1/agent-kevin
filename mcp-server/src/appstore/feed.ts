/**
 * The public feed adapter: Apple's customer-reviews feed, no key. One storefront per request,
 * 50 reviews a page, ten pages at most. The feed serves stale blank pages from its CDN now and
 * then (seen live: a storefront's path address blank while its `?cc=` address returned the same
 * reviews), so a blank page is asked again at the other address before it counts as blank.
 */
import { isRecord } from '@/shared/json-block';
import type { AppStoreReview, ReviewBatch, ReviewSource, StorefrontCoverage } from './types';

const BASE = 'https://itunes.apple.com';
const PAGE_SIZE = 50;
const MAX_PAGES = 10;
const CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;

/** An App Store link (`apps.apple.com/…/id123`), `id123`, or the bare number → the numeric id. */
export const parseAppId = (input: string): string => {
  const value = input.trim();
  const id = /^(?:id)?(\d+)$/i.exec(value)?.[1] ?? /\/id(\d+)(?:[/?#]|$)/.exec(value)?.[1];
  if (!id) {
    throw new Error("Pass the app's App Store link (apps.apple.com/…/id<digits>) or its numeric id.");
  }
  return id;
};

export const feedUrl = (storefront: string, app: string, page: number, alternate = false): string =>
  alternate
    ? `${BASE}/rss/customerreviews/page=${page}/id=${app}/sortby=mostrecent/json?cc=${storefront}`
    : `${BASE}/${storefront}/rss/customerreviews/page=${page}/id=${app}/sortby=mostrecent/json`;

export type FeedPage = { state: 'blank' } | { state: 'ok'; reviews: AppStoreReview[] };

const label = (value: unknown): string | undefined =>
  isRecord(value) && typeof value.label === 'string' ? value.label : undefined;

/** `content` is one label, or a list of them where the plain-text one carries `type: text`. */
const textOf = (value: unknown): string =>
  Array.isArray(value)
    ? (label(value.find((item) => isRecord(item) && isRecord(item.attributes) && item.attributes.type === 'text')) ?? label(value[0]) ?? '')
    : (label(value) ?? '');

const toReview = (entry: unknown, storefront: string): AppStoreReview[] => {
  if (!isRecord(entry)) {
    return [];
  }
  const rating = Number(label(entry['im:rating']));
  const id = label(entry.id);
  const date = label(entry.updated);
  // The app's own metadata rides in the entry list without a rating.
  if (!id || !date || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return [];
  }
  const version = label(entry['im:version']);
  return [
    {
      id,
      storefront,
      rating,
      title: label(entry.title) ?? '',
      text: textOf(entry.content),
      author: (isRecord(entry.author) && label(entry.author.name)) || '',
      ...(version && { version }),
      date
    }
  ];
};

export const parseFeed = (text: string, storefront: string): FeedPage => {
  const data: unknown = JSON.parse(text);
  const entry = isRecord(data) && isRecord(data.feed) ? data.feed.entry : undefined;
  if (entry === undefined) {
    return { state: 'blank' };
  }
  const entries: unknown[] = Array.isArray(entry) ? entry : [entry];
  return { state: 'ok', reviews: entries.flatMap((item) => toReview(item, storefront)) };
};

const getPage = async (url: string, storefront: string): Promise<FeedPage> => {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return parseFeed(await response.text(), storefront);
};

const fetchPage = async (storefront: string, app: string, page: number): Promise<FeedPage> => {
  const first = await getPage(feedUrl(storefront, app, page), storefront);
  return first.state === 'blank' ? getPage(feedUrl(storefront, app, page, true), storefront) : first;
};

const readStorefront = async (storefront: string, app: string, cutoff: number | undefined): Promise<{ reviews: AppStoreReview[]; coverage: StorefrontCoverage }> => {
  const done = (reviews: AppStoreReview[], coverage: Omit<StorefrontCoverage, 'storefront' | 'reviews'>) => ({
    reviews,
    coverage: { storefront, reviews: reviews.length, ...coverage }
  });
  const pages = async (page: number, gathered: AppStoreReview[]): Promise<{ reviews: AppStoreReview[]; coverage: StorefrontCoverage }> => {
    const result = await fetchPage(storefront, app, page).then(
      (feedPage) => ({ feedPage }),
      (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })
    );
    if ('error' in result) {
      return done(gathered, { state: 'error', error: result.error });
    }
    if (result.feedPage.state === 'blank') {
      return page === 1 ? done(gathered, { state: 'blank' }) : done(gathered, { state: 'ok', stop: 'end' });
    }
    const all = result.feedPage.reviews;
    const fresh = cutoff === undefined ? all : all.filter((review) => Date.parse(review.date) >= cutoff);
    const next = [...gathered, ...fresh];
    if (fresh.length < all.length) {
      return done(next, { state: 'ok', stop: 'since' });
    }
    if (all.length < PAGE_SIZE) {
      return done(next, { state: 'ok', stop: 'end' });
    }
    return page === MAX_PAGES ? done(next, { state: 'ok', stop: 'cap' }) : pages(page + 1, next);
  };
  return pages(1, []);
};

/** A few storefronts at a time, pages within each one after another, to stay gentle on the feed. */
const inChunks = async <T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> => {
  const chunks = Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
  return chunks.reduce<Promise<R[]>>(async (done, chunk) => [...(await done), ...(await Promise.all(chunk.map(run)))], Promise.resolve([]));
};

export const feed: ReviewSource = {
  name: 'feed',
  keys: [],
  configured: () => true,
  reviews: async ({ app, storefronts, cutoff }): Promise<ReviewBatch> => {
    const results = await inChunks(storefronts, CONCURRENCY, (storefront) => readStorefront(storefront, app, cutoff));
    return { reviews: results.flatMap((result) => result.reviews), coverage: results.map((result) => result.coverage) };
  }
};
