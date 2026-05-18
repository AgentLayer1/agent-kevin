/**
 * Google Search Console MCP tools — typed wrappers around webmasters v3 +
 * searchconsole v1 using the shared Google OAuth client.
 *
 * Requires GSC_SITE_URL env var (or pass `siteUrl` per-call).
 */
import { log } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { google } from 'googleapis';
import { z } from 'zod';
import { authorizedClient, runAuthFlow } from './google-auth';

const DimEnum = z.enum(['query', 'page', 'date', 'country', 'device', 'searchAppearance']);

function siteUrl(override?: string): string {
  const url = override ?? process.env.GSC_SITE_URL;
  if (!url) throw new Error('GSC_SITE_URL env var not set, and no site URL passed.');
  return url;
}

export const tools: ToolDef[] = [
  defineTool({
    name: 'google_auth',
    description:
      'One-time Google OAuth2 consent flow. Opens browser. Persists tokens under ${CLAUDE_PLUGIN_DATA}/google-auth/. Required before gsc_* and page_speed_* tools work.',
    inputSchema: {},
    handler: async () => runAuthFlow()
  }),
  defineTool({
    name: 'gsc_query',
    description: 'Search analytics rows for the configured site. Default dim=query. Pass `page` to scope to one URL.',
    inputSchema: {
      startDate: z.string().describe('YYYY-MM-DD'),
      endDate: z.string().describe('YYYY-MM-DD'),
      dimensions: z.array(DimEnum).optional().describe('Defaults to ["query"]'),
      page: z.string().optional().describe('Scope to a single page URL'),
      rowLimit: z.number().int().positive().max(25000).optional(),
      siteUrl: z.string().optional().describe('Override GSC_SITE_URL env var')
    },
    handler: async ({ startDate, endDate, dimensions, page, rowLimit, siteUrl: site }) => {
      const webmasters = google.webmasters({ version: 'v3', auth: authorizedClient() });
      const dims = dimensions ?? ['query'];
      const dimensionFilterGroups = page
        ? [{ filters: [{ dimension: 'page', operator: 'equals', expression: page }] }]
        : undefined;
      const { data } = await webmasters.searchanalytics.query({
        siteUrl: siteUrl(site),
        requestBody: { startDate, endDate, dimensions: dims, dimensionFilterGroups, rowLimit: rowLimit ?? 1000 }
      });
      const rows = data.rows ?? [];
      log.info(`gsc_query ${startDate}→${endDate} dims=${dims.join(',')} rows=${rows.length}`);
      return { rows, rowCount: rows.length };
    }
  }),
  defineTool({
    name: 'gsc_inspect',
    description: "Inspect a single URL's indexing status via the URL Inspection API.",
    inputSchema: {
      url: z.string(),
      siteUrl: z.string().optional().describe('Override GSC_SITE_URL env var')
    },
    handler: async ({ url, siteUrl: site }) => {
      const searchconsole = google.searchconsole({ version: 'v1', auth: authorizedClient() });
      const { data } = await searchconsole.urlInspection.index.inspect({
        requestBody: { inspectionUrl: url, siteUrl: siteUrl(site) }
      });
      log.info(`gsc_inspect ${url}`);
      return data;
    }
  }),
  defineTool({
    name: 'gsc_sites',
    description: 'List all sites/properties accessible to the authenticated GSC user.',
    inputSchema: {},
    handler: async () => {
      const webmasters = google.webmasters({ version: 'v3', auth: authorizedClient() });
      const { data } = await webmasters.sites.list();
      const entries = data.siteEntry ?? [];
      log.info(`gsc_sites — ${entries.length} properties`);
      return entries;
    }
  })
];
