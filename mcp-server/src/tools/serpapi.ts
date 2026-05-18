/**
 * SerpAPI MCP tool — typed wrapper.
 */
import { log } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { untrusted } from '@/shared/untrusted';
import { z } from 'zod';

const ENDPOINT = 'https://serpapi.com/search.json';

interface SerpRawResponse {
  search_parameters?: { engine?: string; google_domain?: string; gl?: string; hl?: string; device?: string };
  search_information?: { total_results?: number; time_taken_displayed?: number };
  organic_results?: Array<{
    position?: number;
    title?: string;
    link?: string;
    displayed_link?: string;
    snippet?: string;
    source?: string;
  }>;
  ads?: Array<{ position?: number; title?: string; link?: string }>;
  answer_box?: { type?: string; title?: string; snippet?: string; link?: string; source?: { link?: string } };
  knowledge_graph?: { title?: string; type?: string; description?: string };
  related_questions?: Array<{ question?: string; snippet?: string; title?: string; link?: string }>;
  related_searches?: Array<{ query?: string }>;
  shopping_results?: Array<{ position?: number; title?: string; link?: string; source?: string; price?: string }>;
  ai_overview?: { text_blocks?: unknown[]; references?: unknown[] };
  inline_videos?: unknown[];
  inline_images?: unknown[];
  top_stories?: unknown[];
  local_results?: unknown;
}

function trim(raw: SerpRawResponse, query: string) {
  const features: string[] = [];
  if (raw.ai_overview) features.push('ai_overview');
  if (raw.answer_box) features.push('answer_box');
  if (raw.knowledge_graph) features.push('knowledge_graph');
  if (raw.related_questions?.length) features.push('people_also_ask');
  if (raw.shopping_results?.length) features.push('shopping');
  if (raw.inline_videos?.length) features.push('videos');
  if (raw.inline_images?.length) features.push('images');
  if (raw.top_stories?.length) features.push('top_stories');
  if (raw.local_results) features.push('local_pack');
  if (raw.ads?.length) features.push('ads');

  const params = raw.search_parameters ?? {};
  return {
    query,
    engine: params.engine ?? 'google',
    gl: params.gl ?? 'us',
    hl: params.hl ?? 'en',
    device: params.device ?? 'desktop',
    total_results: raw.search_information?.total_results ?? null,
    time_taken: raw.search_information?.time_taken_displayed ?? null,
    serp_features: features,
    ai_overview: raw.ai_overview
      ? {
          present: true,
          reference_count: raw.ai_overview.references?.length ?? 0,
          block_count: raw.ai_overview.text_blocks?.length ?? 0
        }
      : null,
    answer_box: raw.answer_box
      ? {
          type: raw.answer_box.type ?? '',
          title: raw.answer_box.title ?? '',
          snippet: raw.answer_box.snippet ?? '',
          source: raw.answer_box.source?.link ?? raw.answer_box.link ?? ''
        }
      : null,
    knowledge_graph: raw.knowledge_graph
      ? {
          title: raw.knowledge_graph.title ?? '',
          type: raw.knowledge_graph.type ?? '',
          description: raw.knowledge_graph.description ?? ''
        }
      : null,
    organic_results: (raw.organic_results ?? []).map((r) => ({
      position: r.position ?? 0,
      title: r.title ?? '',
      link: r.link ?? '',
      displayed_link: r.displayed_link ?? '',
      snippet: r.snippet ?? '',
      source: r.source ?? ''
    })),
    shopping_results: (raw.shopping_results ?? []).map((r) => ({
      position: r.position ?? 0,
      title: r.title ?? '',
      link: r.link ?? '',
      source: r.source ?? '',
      price: r.price ?? ''
    })),
    related_questions: (raw.related_questions ?? []).map((r) => ({
      question: r.question ?? r.title ?? '',
      snippet: r.snippet ?? '',
      link: r.link ?? ''
    })),
    related_searches: (raw.related_searches ?? []).map((r) => r.query ?? '').filter(Boolean),
    ad_count: raw.ads?.length ?? 0
  };
}

export const tools: ToolDef[] = [
  defineTool({
    name: 'serpapi_search',
    description:
      'Real Google SERP data: organic results, ads, AI overview, shopping, PAA, knowledge graph. Each call costs one SerpAPI quota unit.',
    inputSchema: {
      query: z.string(),
      engine: z.string().optional().describe('Defaults to "google"'),
      gl: z.string().optional().describe('Country code, defaults to "us"'),
      hl: z.string().optional().describe('UI language, defaults to "en"'),
      num: z.number().int().positive().optional(),
      device: z.enum(['desktop', 'mobile', 'tablet']).optional(),
      location: z.string().optional(),
      googleDomain: z.string().optional()
    },
    handler: async ({ query, engine, gl, hl, num, device, location, googleDomain }) => {
      const key = process.env.SERPAPI_KEY;
      if (!key) throw new Error('SERPAPI_KEY env var not set');
      const params = new URLSearchParams({
        q: query,
        api_key: key,
        engine: engine ?? 'google',
        gl: gl ?? 'us',
        hl: hl ?? 'en'
      });
      if (num) params.set('num', String(num));
      if (device) params.set('device', device);
      if (location) params.set('location', location);
      if (googleDomain) params.set('google_domain', googleDomain);

      const res = await fetch(`${ENDPOINT}?${params.toString()}`);
      const body = await res.text();
      if (!res.ok) {
        let detail = body.slice(0, 400);
        try {
          const parsed = JSON.parse(body) as { error?: string };
          if (parsed.error) detail = parsed.error;
        } catch {
          // keep truncated
        }
        throw new Error(`serpapi search failed (${res.status}): ${detail}`);
      }
      const trimmed = trim(JSON.parse(body) as SerpRawResponse, query);
      log.info(
        `serpapi "${trimmed.query}" device=${trimmed.device} organic=${trimmed.organic_results.length} features=${trimmed.serp_features.join(',') || 'none'}`
      );
      return untrusted(`serpapi:${trimmed.engine}:${trimmed.query}`, JSON.stringify(trimmed, null, 2));
    }
  })
];
