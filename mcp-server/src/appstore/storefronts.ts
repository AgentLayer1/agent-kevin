/**
 * Which storefronts to read when the caller names none. There's no global review feed, so a
 * read is per storefront; the plan starts with every one and then learns where an app's reviews
 * come from, keeping a small discovery slice so a market that starts reviewing is found.
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { FOLDERS } from '@/config';
import { isRecord } from '@/shared/json-block';
import { writeJsonAtomic } from '@/shared/utils';
import type { AppStoreReview, StorefrontCoverage } from './types';

/**
 * Every App Store storefront: the ISO country codes Apple's feed answers 200 for (the rest get a
 * 400). US first, then the largest markets, then A–Z.
 */
export const STOREFRONTS: readonly string[] = [
  'us', 'gb', 'ca', 'au', 'de', 'fr', 'jp', 'cn', 'kr', 'in', 'br', 'mx', 'it', 'es', 'nl', 'se', 'ch', 'tr',
  'sa', 'ae', 'id', 'my', 'sg', 'ph', 'th', 'vn', 'pk', 'eg', 'ng', 'za', 'ru', 'pl', 'ie', 'nz', 'at', 'be',
  'dk', 'no', 'fi', 'pt', 'il', 'hk', 'tw', 'ar', 'cl', 'co', 'ad', 'af', 'ag', 'ai', 'al', 'am', 'ao', 'az',
  'ba', 'bb', 'bd', 'bf', 'bg', 'bh', 'bj', 'bm', 'bn', 'bo', 'bs', 'bt', 'bw', 'by', 'bz', 'cd', 'cf', 'cg',
  'ci', 'cm', 'cr', 'cv', 'cy', 'cz', 'dm', 'do', 'dz', 'ec', 'ee', 'et', 'fj', 'fm', 'ga', 'gd', 'ge', 'gh',
  'gm', 'gn', 'gr', 'gt', 'gw', 'gy', 'hn', 'hr', 'hu', 'iq', 'is', 'jm', 'jo', 'ke', 'kg', 'kh', 'kn', 'kw',
  'ky', 'kz', 'la', 'lb', 'lc', 'li', 'lk', 'lr', 'lt', 'lu', 'lv', 'ly', 'ma', 'mc', 'md', 'me', 'mg', 'mk',
  'ml', 'mm', 'mn', 'mo', 'mr', 'ms', 'mt', 'mu', 'mv', 'mw', 'mz', 'na', 'ne', 'ni', 'np', 'nr', 'om', 'pa',
  'pe', 'pg', 'ps', 'pw', 'py', 'qa', 'ro', 'rs', 'rw', 'sb', 'sc', 'si', 'sk', 'sl', 'sn', 'sr', 'st', 'sv',
  'sz', 'tc', 'td', 'tj', 'tm', 'tn', 'to', 'tt', 'tz', 'ua', 'ug', 'uy', 'uz', 'vc', 've', 'vg', 'vu', 'ws',
  'ye', 'zm', 'zw'
];

const FULL_SWEEP_MS = 30 * 86_400_000;
const DISCOVERY = 15;

export interface StorefrontStats {
  /** Reviews seen here so far, each counted once (newer than the last one seen). */
  reviews: number;
  lastReviewAt?: string;
  lastChecked?: string;
}

export interface AppStats {
  lastFullSweep?: string;
  storefronts: Record<string, StorefrontStats>;
}

export interface StorefrontPlan {
  storefronts: string[];
  full: boolean;
  active: number;
  discovery: number;
}

const rank = (storefront: string): number => STOREFRONTS.indexOf(storefront);

const fullSweep = (): StorefrontPlan => ({ storefronts: [...STOREFRONTS], full: true, active: 0, discovery: 0 });

/** Every storefront when nothing is known or the last full sweep is a month old; else where reviews come from, plus a discovery slice. */
export const planStorefronts = (stats: AppStats | undefined, now: Date): StorefrontPlan => {
  const swept = stats?.lastFullSweep ? Date.parse(stats.lastFullSweep) : Number.NaN;
  if (!stats || !(now.getTime() - swept <= FULL_SWEEP_MS)) {
    return fullSweep();
  }
  const seen = (storefront: string): StorefrontStats | undefined => stats.storefronts[storefront];
  const active = STOREFRONTS.filter((storefront) => (seen(storefront)?.reviews ?? 0) > 0).toSorted(
    (left, right) => Number(right === 'us') - Number(left === 'us') || (seen(right)?.reviews ?? 0) - (seen(left)?.reviews ?? 0) || rank(left) - rank(right)
  );
  const checkedAt = (storefront: string): number => Date.parse(seen(storefront)?.lastChecked ?? '') || 0;
  const discovery = STOREFRONTS.filter((storefront) => !active.includes(storefront))
    .toSorted((left, right) => checkedAt(left) - checkedAt(right) || rank(left) - rank(right))
    .slice(0, DISCOVERY);
  return { storefronts: [...active, ...discovery], full: false, active: active.length, discovery: discovery.length };
};

/** Folds one read into the stats. A read where nothing came back teaches nothing: the feed may simply have been blank. */
export const updateStats = (
  stats: AppStats | undefined,
  coverage: readonly StorefrontCoverage[],
  reviews: readonly AppStoreReview[],
  options: { full: boolean; now: Date }
): AppStats => {
  const base: AppStats = stats ?? { storefronts: {} };
  if (!coverage.some((entry) => entry.state === 'ok')) {
    return base;
  }
  const at = options.now.toISOString();
  const answered = coverage.filter((entry) => entry.state !== 'error');
  const updated = Object.fromEntries(
    answered.map(({ storefront }) => {
      const before = base.storefronts[storefront];
      const lastSeen = Date.parse(before?.lastReviewAt ?? '') || 0;
      const dates = reviews
        .filter((review) => review.storefront === storefront)
        .map((review) => Date.parse(review.date))
        .filter(Number.isFinite);
      const fresh = dates.filter((date) => date > lastSeen).length;
      const newest = Math.max(lastSeen, ...dates);
      return [
        storefront,
        { reviews: (before?.reviews ?? 0) + fresh, ...(newest > 0 && { lastReviewAt: new Date(newest).toISOString() }), lastChecked: at }
      ];
    })
  );
  const lastFullSweep = options.full ? at : base.lastFullSweep;
  return { ...(lastFullSweep && { lastFullSweep }), storefronts: { ...base.storefronts, ...updated } };
};

const statsFile = (app: string): string => join(FOLDERS.APPSTORE, `${app}.json`);

export const readStats = (app: string): AppStats | undefined => {
  try {
    const data: unknown = JSON.parse(readFileSync(statsFile(app), 'utf-8'));
    return isRecord(data) && isRecord(data.storefronts) ? (data as unknown as AppStats) : undefined;
  } catch {
    return undefined;
  }
};

export const writeStats = (app: string, stats: AppStats): void => writeJsonAtomic(statsFile(app), stats);
