/**
 * Web search MCP tool (web_search) — typed wrapper over the Perplexity Search API.
 */
import { log } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { untrusted } from '@/shared/untrusted';
import { z } from 'zod';

const ENDPOINT = 'https://api.perplexity.ai/search';

interface PerplexityRawResponse {
  id?: string;
  server_time?: string | null;
  results?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    date?: string | null;
    last_updated?: string | null;
  }>;
}

interface PerplexityRequestBody {
  query: string;
  max_results: number;
  max_tokens_per_page: number;
  search_recency_filter?: 'hour' | 'day' | 'week' | 'month' | 'year';
  search_domain_filter?: string[];
  country?: string;
}

export const tools: ToolDef[] = [
  defineTool({
    name: 'web_search',
    description:
      'Search the web via Perplexity. Returns a ranked list of {title, url, snippet, date} — no AI synthesis. Best for news, fact-finding, source discovery. Supports recency + domain filters.',
    inputSchema: {
      query: z.string(),
      max_results: z.number().int().min(1).max(20).optional().describe('1–20, default 10'),
      recency: z.enum(['hour', 'day', 'week', 'month', 'year']).optional().describe('Time-window filter'),
      domains: z.array(z.string()).max(20).optional().describe('Restrict to these domains (max 20)'),
      country: z.string().length(2).optional().describe('ISO 3166-1 alpha-2 country code'),
      max_tokens_per_page: z.number().int().min(256).max(4096).optional().describe('Defaults to 1024')
    },
    handler: async ({ query, max_results, recency, domains, country, max_tokens_per_page }) => {
      const key = process.env.PERPLEXITY_API_KEY;
      if (!key) throw new Error('PERPLEXITY_API_KEY env var not set');

      const body: PerplexityRequestBody = {
        query,
        max_results: max_results ?? 10,
        max_tokens_per_page: max_tokens_per_page ?? 1024
      };
      if (recency) body.search_recency_filter = recency;
      if (domains?.length) body.search_domain_filter = domains;
      if (country) body.country = country;

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const text = await res.text();
      if (!res.ok) {
        let detail = text.slice(0, 400);
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string } | string };
          const msg = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
          if (msg) detail = msg;
        } catch {
          // keep truncated
        }
        throw new Error(`perplexity search failed (${res.status}): ${detail}`);
      }

      const raw = JSON.parse(text) as PerplexityRawResponse;
      const trimmed = {
        query,
        result_count: raw.results?.length ?? 0,
        results: (raw.results ?? []).map((r) => ({
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: r.snippet ?? '',
          date: r.date ?? r.last_updated ?? null
        }))
      };

      log.info(`perplexity "${query}" results=${trimmed.result_count}${recency ? ` recency=${recency}` : ''}`);
      return untrusted(`perplexity:${query}`, JSON.stringify(trimmed, null, 2));
    }
  })
];
