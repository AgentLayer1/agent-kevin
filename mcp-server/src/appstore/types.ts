/**
 * App Store reviews in one shape, whichever source read them. A source is an adapter: the
 * public feed today, App Store Connect later, each a `ReviewSource` registered in sources.ts.
 * Nothing above the adapters knows which one answered beyond its name.
 */

export const REVIEW_SOURCES = ['feed'] as const;
export type ReviewSourceName = (typeof REVIEW_SOURCES)[number];

export interface AppStoreReview {
  id: string;
  storefront: string;
  rating: number;
  title: string;
  text: string;
  /** The reviewer's public nickname. */
  author: string;
  version?: string;
  date: string;
}

/** `blank`: the storefront returned no reviews at all, which alone can't tell "none" from a blank feed. */
export type CoverageState = 'ok' | 'blank' | 'error';
/** Why paging stopped: past the cutoff, the reviews ran out, or the source's page limit. */
export type CoverageStop = 'since' | 'end' | 'cap';

export interface StorefrontCoverage {
  storefront: string;
  state: CoverageState;
  reviews: number;
  stop?: CoverageStop;
  error?: string;
}

export interface ReviewQuery {
  app: string;
  storefronts: readonly string[];
  /** Epoch ms; reviews older than this are left out. Absent means any age. */
  cutoff?: number;
}

export interface ReviewBatch {
  reviews: AppStoreReview[];
  coverage: StorefrontCoverage[];
}

export interface ReviewSource {
  name: ReviewSourceName;
  /** The keys it needs, for setup errors; none for the feed. */
  keys: readonly string[];
  configured: () => boolean;
  reviews: (query: ReviewQuery) => Promise<ReviewBatch>;
}
