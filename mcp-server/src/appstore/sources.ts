import { pluginName } from '@/shared/naming';
import { feed } from './feed';
import { REVIEW_SOURCES, type AppStoreReview, type ReviewBatch, type ReviewSource, type ReviewSourceName } from './types';

const SOURCES: Readonly<Record<ReviewSourceName, ReviewSource>> = { feed };

/** The source a call means: the one named, or the first configured in `REVIEW_SOURCES` order. */
export const resolveSource = (
  name: ReviewSourceName | undefined,
  sources: Readonly<Record<ReviewSourceName, ReviewSource>> = SOURCES
): ReviewSource => {
  const pick = name ? sources[name] : REVIEW_SOURCES.map((source) => sources[source]).find((source) => source.configured());
  if (!pick || !pick.configured()) {
    const keys = pick?.keys.join(', ') ?? 'its keys';
    throw new Error(`The ${name ?? 'App Store'} review source isn't set up: it needs ${keys} (run /${pluginName()}:configure-skills → App Store pack).`);
  }
  return pick;
};

export interface ReviewFilters {
  minRating?: number;
  maxRating?: number;
  limit: number;
}

export interface CoverageSummary {
  read: number;
  /** Reviews found in the window, per storefront that had any. */
  with_reviews: Record<string, number>;
  /** Storefronts that answered with no reviews: named when the caller named them, else a count. */
  blank: number | string[];
  errors: Array<{ storefront: string; error: string }>;
  capped: string[];
}

export interface ReviewSummary {
  complete: boolean;
  coverage: CoverageSummary;
  warnings: string[];
  ratings?: Record<string, number>;
  total?: number;
  returned?: number;
  reviews?: AppStoreReview[];
}

const newestFirst = (left: AppStoreReview, right: AppStoreReview): number => Date.parse(right.date) - Date.parse(left.date);

/**
 * One read's reviews and coverage, made safe to report. A storefront with no reviews looks the
 * same as a blank feed, so only a read where nothing at all came back is called a blank feed, and
 * then no count is given: blank is never zero.
 */
export const summarize = (batch: ReviewBatch, filters: ReviewFilters, named: boolean): ReviewSummary => {
  const ok = batch.coverage.filter((entry) => entry.state === 'ok');
  const blank = batch.coverage.filter((entry) => entry.state === 'blank').map((entry) => entry.storefront);
  const errors = batch.coverage.flatMap((entry) => (entry.state === 'error' ? [{ storefront: entry.storefront, error: entry.error ?? 'failed' }] : []));
  const capped = ok.filter((entry) => entry.stop === 'cap').map((entry) => entry.storefront);
  const coverage: CoverageSummary = {
    read: batch.coverage.length,
    with_reviews: Object.fromEntries(ok.filter((entry) => entry.reviews > 0).map((entry) => [entry.storefront, entry.reviews])),
    blank: named ? blank : blank.length,
    errors,
    capped
  };
  const warnings = [
    ...(ok.length === 0 && errors.length === 0
      ? [`Apple's review feed came back empty for every storefront read (${batch.coverage.length}). It does this now and then; this is not zero reviews. Try again later.`]
      : []),
    ...(errors.length > 0 ? [`Not read: ${errors.map((entry) => `${entry.storefront} (${entry.error})`).join(', ')}.`] : []),
    ...(capped.length > 0 ? [`${capped.join(', ')} reached the most recent reviews the source keeps before the window began; older reviews there aren't covered.`] : [])
  ];
  const complete = ok.length > 0 && errors.length === 0;
  if (ok.length === 0) {
    return { complete, coverage, warnings };
  }
  const unique = [...new Map(batch.reviews.map((review) => [review.id, review])).values()].sort(newestFirst);
  const ratings = Object.fromEntries([1, 2, 3, 4, 5].map((stars) => [String(stars), unique.filter((review) => review.rating === stars).length]));
  const kept = unique.filter(
    (review) => (filters.minRating === undefined || review.rating >= filters.minRating) && (filters.maxRating === undefined || review.rating <= filters.maxRating)
  );
  const reviews = kept.slice(0, filters.limit);
  return { complete, coverage, warnings, ratings, total: unique.length, returned: reviews.length, reviews };
};
