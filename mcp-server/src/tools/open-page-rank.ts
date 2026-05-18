/**
 * OpenPageRank MCP tool.
 */
import { defineTool, type ToolDef } from '@/shared/types';
import { untrusted } from '@/shared/untrusted';
import { z } from 'zod';

const ENDPOINT = 'https://openpagerank.com/api/v1.0/getPageRank';

export const tools: ToolDef[] = [
  defineTool({
    name: 'open_page_rank',
    description:
      'Get OpenPageRank score for up to 100 domains. Returns rank (0-10) + estimated PR. Needs OPENPAGERANK_API_KEY.',
    inputSchema: {
      domains: z.array(z.string()).min(1).max(100)
    },
    handler: async ({ domains }) => {
      const key = process.env.OPENPAGERANK_API_KEY;
      if (!key) throw new Error('OPENPAGERANK_API_KEY env var not set');
      const params = new URLSearchParams();
      domains.forEach((d, i) => params.append(`domains[${i}]`, d));
      const res = await fetch(`${ENDPOINT}?${params.toString()}`, { headers: { 'API-OPR': key } });
      const body = await res.text();
      if (!res.ok) throw new Error(`open-page-rank failed (${res.status}): ${body.slice(0, 400)}`);
      return untrusted('openpagerank', JSON.stringify(JSON.parse(body), null, 2));
    }
  })
];
