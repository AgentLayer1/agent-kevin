/**
 * Pylon REST client — reads, plus one write: an internal note.
 *
 * Endpoints: `POST /issues/search`, `GET /issues/{id}`,
 * `GET /issues/{id}/messages`, `GET /accounts`, `GET /tags`, `GET /users`,
 * `GET /macros`, and `POST /issues/{id}/note`,
 * which Pylon documents as not visible to the requester. The search POST is
 * semantically a read; nothing that replies to a customer or edits an issue
 * is wrapped.
 *
 * Handles 429 rate-limit retry with Retry-After header (Pylon limits are
 * tight — 10–60 req/min per endpoint). Cursor-paginates collection endpoints
 * via `pagination.cursor` / `has_next_page`.
 */
import { log as baseLog } from '@/shared/log';
import { PYLON_API_BASE } from './config';
import type { PylonAccount, PylonEnvelope, PylonIssue, PylonMacro, PylonMessage, PylonTag, PylonUser } from './types';

const log = baseLog.pylon.with('client');

/** Backstop for the exhaustive-pagination helpers, not an expected state. */
const MAX_PAGES = 50;

interface CallOptions {
  query?: Record<string, string | number>;
  body?: unknown;
}

async function call<T>(token: string, method: 'GET' | 'POST', path: string, options: CallOptions = {}): Promise<PylonEnvelope<T>> {
  const url = new URL(`${PYLON_API_BASE}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(options.body !== undefined && { 'Content-Type': 'application/json' })
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '5');
      log.warn(`${method} ${path} rate-limited; sleeping ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Pylon API ${method} ${path} failed (${res.status}): ${errorDetail(text)}`);
    }
    return JSON.parse(text) as PylonEnvelope<T>;
  }
  throw new Error(`Pylon API ${method} ${path} failed: exhausted retries (rate limit)`);
}

/** Pull a human-readable message out of an error body, whatever its shape. */
function errorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { errors?: string[]; error?: string; message?: string };
    if (parsed.errors?.length) return parsed.errors.join('; ');
    if (parsed.error) return parsed.error;
    if (parsed.message) return parsed.message;
  } catch {
    // fall through to the raw body
  }
  return body.slice(0, 400);
}

async function paginate<T>(fetchPage: (cursor?: string) => Promise<PylonEnvelope<T[]>>): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const envelope = await fetchPage(cursor);
    all.push(...(envelope.data ?? []));
    if (!envelope.pagination?.has_next_page || !envelope.pagination.cursor) return all;
    cursor = envelope.pagination.cursor;
  }
  log.warn(`pagination stopped at ${MAX_PAGES} pages (${all.length} items) — result is truncated`);
  return all;
}

/** Leaf comparison or `and`/`or` composite (max depth 3, per Pylon docs). */
export interface IssueFilter {
  field?: string;
  operator: string;
  value?: string;
  subfilters?: IssueFilter[];
}

export interface IssueSearchBody {
  filter?: IssueFilter;
  search_text?: string;
  limit?: number;
  cursor?: string;
}

export interface IssuePage {
  issues: PylonIssue[];
  cursor?: string;
  has_next_page: boolean;
}

export async function searchIssues(token: string, body: IssueSearchBody): Promise<IssuePage> {
  const envelope = await call<PylonIssue[]>(token, 'POST', '/issues/search', { body });
  return {
    issues: envelope.data ?? [],
    cursor: envelope.pagination?.cursor,
    has_next_page: envelope.pagination?.has_next_page ?? false
  };
}

export async function getIssue(token: string, id: string): Promise<PylonIssue> {
  const envelope = await call<PylonIssue>(token, 'GET', `/issues/${encodeURIComponent(id)}`);
  if (!envelope.data) throw new Error(`Pylon issue ${id} returned no data`);
  return envelope.data;
}

export async function getIssueMessages(token: string, id: string): Promise<PylonMessage[]> {
  return paginate((cursor) =>
    call<PylonMessage[]>(token, 'GET', `/issues/${encodeURIComponent(id)}/messages`, {
      query: { limit: 1000, ...(cursor && { cursor }) }
    })
  );
}

export async function listAccounts(token: string): Promise<PylonAccount[]> {
  return paginate((cursor) => call<PylonAccount[]>(token, 'GET', '/accounts', { query: cursor ? { cursor } : {} }));
}

export async function listTags(token: string): Promise<PylonTag[]> {
  return paginate((cursor) => call<PylonTag[]>(token, 'GET', '/tags', { query: cursor ? { cursor } : {} }));
}

export async function listUsers(token: string): Promise<PylonUser[]> {
  return paginate((cursor) => call<PylonUser[]>(token, 'GET', '/users', { query: cursor ? { cursor } : {} }));
}

export async function listMacros(token: string, groupId?: string): Promise<PylonMacro[]> {
  return paginate((cursor) =>
    call<PylonMacro[]>(token, 'GET', '/macros', {
      query: { ...(groupId && { macro_group_id: groupId }), ...(cursor && { cursor }) }
    })
  );
}

/** Posts an internal note on an issue; Pylon never shows it to the requester. */
export async function addNote(token: string, id: string, bodyHtml: string): Promise<PylonMessage> {
  const envelope = await call<PylonMessage>(token, 'POST', `/issues/${encodeURIComponent(id)}/note`, {
    body: { body_html: bodyHtml }
  });
  if (!envelope.data) throw new Error(`Pylon note on issue ${id} returned no data`);
  return envelope.data;
}
