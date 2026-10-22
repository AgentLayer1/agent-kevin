/**
 * App Store reviews for any app, read-only, through whichever review source answers (the public
 * feed today). Review text is third-party content, so it comes back wrapped as untrusted, and
 * nothing here can reply to a review.
 */
import { parseAppId } from '@/appstore/feed';
import { resolveSource, summarize } from '@/appstore/sources';
import { fullSweep, planStorefronts, readStats, STOREFRONTS, updateStats, writeStats, type AppStats, type StorefrontPlan } from '@/appstore/storefronts';
import { REVIEW_SOURCES, type ReviewSource } from '@/appstore/types';
import { sinceToStartTime } from '@/shared/date';
import { log } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { untrusted } from '@/shared/untrusted';
import { z } from 'zod';

export interface ReviewsArgs {
  app: string;
  storefronts?: readonly string[];
  since?: string;
  min_rating?: number;
  max_rating?: number;
  limit?: number;
}

/** A window (`Nh`/`Nd`/`Nw`/`Nm`), `any`, or an ISO date such as a previous read's `through`. */
export const cutoffOf = (since: string, now: Date): number | undefined => {
  if (since === 'any') {
    return undefined;
  }
  const at = /^\d+[hdwm]$/.test(since) ? Date.parse(sinceToStartTime(since, now)) : Date.parse(since);
  if (Number.isNaN(at)) {
    throw new Error("since takes Nh / Nd / Nw / Nm, 'any', or an ISO date.");
  }
  return at;
};

const namedStorefronts = (storefronts: readonly string[]): string[] => {
  const codes = [...new Set(storefronts.map((code) => code.trim().toLowerCase()))];
  const unknown = codes.filter((code) => !STOREFRONTS.includes(code));
  if (unknown.length > 0) {
    throw new Error(`Not App Store storefronts: ${unknown.join(', ')}. Use two-letter country codes such as us, gb, my.`);
  }
  return codes;
};

const choosePlan = (storefronts: readonly string[] | undefined, stats: AppStats | undefined, now: Date): StorefrontPlan => {
  if (storefronts?.length === 1 && storefronts[0]?.toLowerCase() === 'all') {
    return fullSweep();
  }
  return storefronts ? { storefronts: namedStorefronts(storefronts), read: 'named' } : planStorefronts(stats, now);
};

export const readReviews = async (args: ReviewsArgs, source: ReviewSource, now: Date = new Date()): Promise<string> => {
  const app = parseAppId(args.app);
  const since = args.since ?? '30d';
  const cutoff = cutoffOf(since, now);
  const stats = readStats(app);
  const plan = choosePlan(args.storefronts, stats, now);
  const batch = await source.reviews({ app, storefronts: plan.storefronts, cutoff });
  writeStats(app, updateStats(stats, batch.coverage, batch.reviews, { full: plan.read === 'every storefront', now }));
  const reviewed = new Set(Object.entries(stats?.storefronts ?? {}).flatMap(([storefront, seen]) => (seen.reviews > 0 ? [storefront] : [])));
  const summary = summarize(batch, { minRating: args.min_rating, maxRating: args.max_rating, limit: args.limit ?? 100 }, plan.read === 'named', reviewed);
  log.info(`appstore ${app} source=${source.name} storefronts=${plan.storefronts.length} reviews=${summary.total ?? 'none read'}`);
  const read = {
    read: plan.read,
    storefronts: plan.storefronts.length,
    of: STOREFRONTS.length,
    ...(plan.active !== undefined && { active: plan.active, discovery: plan.discovery }),
    ...(stats?.lastFullSweep && { last_full_sweep: stats.lastFullSweep })
  };
  return untrusted(`appstore:${app}`, JSON.stringify({ source: source.name, app, since, through: now.toISOString(), plan: read, ...summary }, null, 2));
};

export const tools: ToolDef[] = [
  defineTool({
    name: 'appstore_reviews',
    description:
      "Read App Store reviews for any app, newest first: rating, title, text, the reviewer's nickname, app version, date and storefront, with rating counts. Read-only; no key; it never replies to a review. Reviews are per country storefront: name storefronts to narrow the read, pass ['all'] for every one, or leave it out and the tool picks them, learning over time where the app's reviews come from. Apple's public feed keeps about the 500 most recent per storefront and sometimes comes back blank: coverage says what was read, and a read where nothing came back gives no count, never zero. A long window can come back short, since a blank page past a storefront's first reads as the end of its reviews.",
    inputSchema: {
      source: z.enum(REVIEW_SOURCES).optional().describe('Which review source; omit to use the first one set up.'),
      app: z.string().min(1).describe('The App Store link (apps.apple.com/…/id<digits>) or the numeric app id.'),
      storefronts: z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .describe("Two-letter country codes to read, or ['all']. Omit to let the tool choose."),
      since: z
        .string()
        .optional()
        .describe("Reviews newer than this: Nh / Nd / Nw / Nm, 'any', or an ISO date (a previous read's through). Default 30d."),
      min_rating: z.number().int().min(1).max(5).optional(),
      max_rating: z.number().int().min(1).max(5).optional(),
      limit: z.number().int().positive().max(2000).optional().describe('Max reviews returned (counts cover all). Default 100.')
    },
    handler: async (args) => readReviews(args, resolveSource(args.source))
  })
];
