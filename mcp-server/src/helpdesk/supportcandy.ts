/**
 * SupportCandy connector — the WordPress helpdesk plugin's REST API
 * (`/wp-json/supportcandy/v2`), authenticated as one WordPress user with an
 * application password. That user's SupportCandy agent role decides what the
 * calls may do; the plugin checks reply and private-note rights separately, so
 * a role with view + private note can't answer a customer even if asked to.
 *
 * Shapes follow the plugin source (`includes/rest-api/`): lists come back as
 * `{ total_items, has_next_page, results }`, ticket status and category as
 * numeric ids, dates as UTC `Y-m-d H:i:s`.
 */
import { pluginName, RUNTIME_DIR } from '@/shared/naming';
import { env } from '@/shared/env';
import { htmlToText } from '@/pylon/format';
import { fetchFile } from './download';
import { MESSAGE_KINDS, type HelpdeskConnector, type HelpdeskMessage, type HelpdeskTicket, type MessageKind } from './types';

const API_PATH = '/wp-json/supportcandy/v2';
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const LIST_PREVIEW_CHARS = 400;

interface Credentials {
  site: string;
  username: string;
  password: string;
}

export interface ScTicket {
  id: number;
  subject?: string;
  status?: number;
  category?: number;
  customer?: number;
  date_created?: string;
  date_updated?: string;
}

export interface ScThread {
  id: number;
  customer?: number;
  type?: string;
  body?: string | Record<string, unknown>;
  /** Comma-separated attachment ids, empty when none. */
  attachments?: string;
  date_created?: string;
}

/** `GET /attachments/<id>`; the url carries its own auth code, so it never leaves this module. */
interface ScAttachment {
  id: number;
  name?: string;
  url?: string;
}

interface ScPage<T> {
  total_items?: number;
  has_next_page?: boolean;
  results?: T[];
}

interface ScNamed {
  id: number;
  name?: string;
}

export interface Lookups {
  statuses: ReadonlyMap<number, string>;
  categories: ReadonlyMap<number, string>;
}

const credentials = (): Credentials | null => {
  const site = env('SUPPORTCANDY_URL')?.replace(/\/+$/, '');
  const username = env('SUPPORTCANDY_USERNAME');
  const password = env('SUPPORTCANDY_APP_PASSWORD');
  return site && username && password ? { site, username, password } : null;
};

const requireCredentials = (): Credentials => {
  const found = credentials();
  if (!found) {
    throw new Error(
      `SupportCandy isn't configured. Set SUPPORTCANDY_URL and SUPPORTCANDY_USERNAME in settings.local.json env and ` +
        `SUPPORTCANDY_APP_PASSWORD in <HOME>/${RUNTIME_DIR}/secrets/.env (run /${pluginName()}:configure-skills → Helpdesk pack).`
    );
  }
  return found;
};

const call = async <T>(path: string, init: { method?: 'GET' | 'POST'; query?: Record<string, string | number>; form?: Record<string, string> } = {}): Promise<T> => {
  const { site, username, password } = requireCredentials();
  const url = new URL(`${site}${API_PATH}${path}`);
  Object.entries(init.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      Accept: 'application/json'
    },
    body: init.form ? new URLSearchParams(init.form) : undefined
  });
  const text = await response.text();
  if (!response.ok) {
    const hint =
      response.status === 404
        ? ' (is the REST API switched on in SupportCandy → Settings → Advanced?)'
        : response.status === 401
          ? ' (check the username and application password, and that the user is a SupportCandy agent)'
          : '';
    throw new Error(`SupportCandy ${init.method ?? 'GET'} ${path} failed (${response.status})${hint}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
};

/** `2026-10-20 08:15:00` (UTC, as WordPress stores it) → ISO 8601; empty stays empty. */
export const toIso = (value: string | undefined): string | undefined =>
  value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : undefined;

export const adminLink = (site: string, id: number): string =>
  `${site}/wp-admin/admin.php?page=wpsc-tickets&section=ticket-list&id=${id}`;

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export const mapTicket = (raw: ScTicket, lookups: Lookups, site: string, body: string): HelpdeskTicket => ({
  id: String(raw.id),
  helpdesk: 'supportcandy',
  subject: raw.subject ?? '',
  status: (raw.status !== undefined && lookups.statuses.get(raw.status)) || String(raw.status ?? ''),
  ...(raw.category !== undefined && { category: lookups.categories.get(raw.category) ?? String(raw.category) }),
  tags: [],
  created_at: toIso(raw.date_created),
  updated_at: toIso(raw.date_updated),
  link: adminLink(site, raw.id),
  body
});

const kindOf = (thread: ScThread, ticketCustomer: number | undefined): MessageKind => {
  if (thread.type === 'note') {
    return MESSAGE_KINDS.note;
  }
  if (thread.type === 'log') {
    return MESSAGE_KINDS.event;
  }
  return thread.customer !== undefined && thread.customer === ticketCustomer ? MESSAGE_KINDS.customer : MESSAGE_KINDS.agent;
};

export const attachmentIds = (thread: ScThread): string[] =>
  String(thread.attachments ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

export const mapThread = async (
  thread: ScThread,
  ticketCustomer: number | undefined,
  attachmentNames: ReadonlyMap<string, string> = new Map()
): Promise<HelpdeskMessage> => ({
  id: String(thread.id),
  kind: kindOf(thread, ticketCustomer),
  created_at: toIso(thread.date_created),
  body: typeof thread.body === 'string' ? await htmlToText(thread.body) : JSON.stringify(thread.body ?? {}),
  attachments: attachmentIds(thread).map((id) => ({ id, name: attachmentNames.get(id) ?? `attachment-${id}` }))
});

const lookups = async (): Promise<Lookups> => {
  const [statuses, categories] = await Promise.all([call<ScNamed[]>('/statuses'), call<ScNamed[]>('/categories')]);
  const toMap = (items: ScNamed[]): Map<number, string> => new Map(items.map((item) => [item.id, item.name ?? String(item.id)]));
  return { statuses: toMap(statuses), categories: toMap(categories) };
};

const allThreads = async (id: string): Promise<ScThread[]> => {
  const pages = async (page: number, gathered: ScThread[]): Promise<ScThread[]> => {
    const result = await call<ScPage<ScThread>>(`/tickets/${encodeURIComponent(id)}/threads`, {
      query: { page, per_page: PAGE_SIZE, order: 'ASC' }
    });
    const next = [...gathered, ...(result.results ?? [])];
    return result.has_next_page && page < MAX_PAGES ? pages(page + 1, next) : next;
  };
  return pages(1, []);
};

/** The opening message: SupportCandy files a ticket's description as its first `report` thread. */
const openingText = async (id: number): Promise<string> => {
  const first = await call<ScPage<ScThread>>(`/tickets/${id}/threads`, { query: { page: 1, per_page: 1, order: 'ASC' } });
  const thread = first.results?.[0];
  return thread && typeof thread.body === 'string' ? htmlToText(thread.body) : '';
};

export const supportcandy: HelpdeskConnector = {
  name: 'supportcandy',
  configured: () => credentials() !== null,
  list: async (query) => {
    const { site } = requireCredentials();
    const names = await lookups();
    const cutoff = Date.parse(query.updatedSince);
    const recent = async (page: number, gathered: ScTicket[]): Promise<ScTicket[]> => {
      const result = await call<ScPage<ScTicket>>('/tickets', {
        query: { page, per_page: PAGE_SIZE, orderby: 'date_updated', order: 'DESC', ...(query.search && { search: query.search }) }
      });
      const fresh = (result.results ?? []).filter((ticket) => Date.parse(toIso(ticket.date_updated) ?? '') >= cutoff);
      const next = [...gathered, ...fresh];
      const reachedCutoff = fresh.length < (result.results ?? []).length;
      return result.has_next_page && !reachedCutoff && next.length < query.limit && page < MAX_PAGES ? recent(page + 1, next) : next;
    };
    const wanted = query.status?.map((status) => status.toLowerCase());
    const tickets = (await recent(1, []))
      .map((raw) => ({ raw, ticket: mapTicket(raw, names, site, '') }))
      .filter(({ ticket }) => !wanted || wanted.includes(ticket.status.toLowerCase()))
      .slice(0, query.limit);
    return Promise.all(
      tickets.map(async ({ raw, ticket }) => ({ ...ticket, body: truncate(await openingText(raw.id), LIST_PREVIEW_CHARS) }))
    );
  },
  get: async (id) => {
    const { site } = requireCredentials();
    const [raw, names, threads] = await Promise.all([call<ScTicket>(`/tickets/${encodeURIComponent(id)}`), lookups(), allThreads(id)]);
    const ids = threads.flatMap(attachmentIds);
    const found = await Promise.all(ids.map((id) => call<ScAttachment>(`/attachments/${encodeURIComponent(id)}`)));
    const attachmentNames = new Map(found.map((attachment) => [String(attachment.id), attachment.name ?? `attachment-${attachment.id}`]));
    const messages = await Promise.all(threads.map((thread) => mapThread(thread, raw.customer, attachmentNames)));
    const opening = messages.find((message) => message.kind === MESSAGE_KINDS.customer)?.body ?? '';
    return { ticket: mapTicket(raw, names, site, opening), messages };
  },
  addNote: async (id, bodyHtml) => {
    const created = await call<{ id?: number } | ScThread>(`/tickets/${encodeURIComponent(id)}/threads`, {
      method: 'POST',
      form: { type: 'note', body: bodyHtml }
    });
    return String(created.id ?? '');
  },
  download: async (attachmentId) => {
    const attachment = await call<ScAttachment>(`/attachments/${encodeURIComponent(attachmentId)}`);
    if (!attachment.url) {
      throw new Error(`SupportCandy attachment ${attachmentId} has no download link`);
    }
    return fetchFile(attachment.url, attachment.name ?? `attachment-${attachmentId}`);
  }
};
