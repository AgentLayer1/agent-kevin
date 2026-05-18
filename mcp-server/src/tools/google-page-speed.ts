/**
 * PageSpeed Insights MCP tools — typed wrappers using the shared Google OAuth.
 */
import { log } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { google } from 'googleapis';
import { z } from 'zod';
import { authorizedClient } from './google-auth';

type Strategy = 'mobile' | 'desktop';

interface PsiSlice {
  url: string;
  strategy: Strategy;
  performance_score: number | null;
  metrics: {
    lcp_ms: number | null;
    cls: number | null;
    inp_ms: number | null;
    fcp_ms: number | null;
    tbt_ms: number | null;
    si_ms: number | null;
  };
  fetched_at: string;
}

const num = (audits: Record<string, unknown>, id: string): number | null => {
  const audit = audits[id] as { numericValue?: number } | undefined;
  return typeof audit?.numericValue === 'number' ? Math.round(audit.numericValue) : null;
};

const unitless = (audits: Record<string, unknown>, id: string): number | null => {
  const audit = audits[id] as { numericValue?: number } | undefined;
  return typeof audit?.numericValue === 'number' ? Math.round(audit.numericValue * 1000) / 1000 : null;
};

async function fetchPsi(url: string, strategy: Strategy): Promise<PsiSlice> {
  const psi = google.pagespeedonline({ version: 'v5', auth: authorizedClient() });
  const res = await psi.pagespeedapi.runpagespeed({ url, strategy, category: ['PERFORMANCE'] });
  const lh = (res.data.lighthouseResult ?? {}) as {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, unknown>;
  };
  const audits = lh.audits ?? {};
  const score = lh.categories?.performance?.score;
  return {
    url,
    strategy,
    performance_score: typeof score === 'number' ? Math.round(score * 100) : null,
    metrics: {
      lcp_ms: num(audits, 'largest-contentful-paint'),
      cls: unitless(audits, 'cumulative-layout-shift'),
      inp_ms: num(audits, 'interaction-to-next-paint'),
      fcp_ms: num(audits, 'first-contentful-paint'),
      tbt_ms: num(audits, 'total-blocking-time'),
      si_ms: num(audits, 'speed-index')
    },
    fetched_at: new Date().toISOString()
  };
}

export const tools: ToolDef[] = [
  defineTool({
    name: 'page_speed_psi',
    description:
      'Lighthouse PageSpeed Insights slice for one URL+strategy. Returns performance_score + Core Web Vitals.',
    inputSchema: {
      url: z.string(),
      strategy: z.enum(['mobile', 'desktop']).optional().describe('Defaults to mobile')
    },
    handler: async ({ url, strategy }) => {
      const s = strategy ?? 'mobile';
      const slice = await fetchPsi(url, s);
      log.info(`psi ${s} ${url} score=${slice.performance_score}`);
      return slice;
    }
  }),
  defineTool({
    name: 'page_speed_audit',
    description: 'Run PSI for both mobile + desktop in parallel. Returns { mobile, desktop } trimmed.',
    inputSchema: { url: z.string() },
    handler: async ({ url }) => {
      const [mobile, desktop] = await Promise.all([fetchPsi(url, 'mobile'), fetchPsi(url, 'desktop')]);
      log.info(`audit ${url} mobile=${mobile.performance_score} desktop=${desktop.performance_score}`);
      return { mobile, desktop };
    }
  })
];
