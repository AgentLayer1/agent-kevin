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
import { env, suffixedKey } from '@/shared/env';
import { htmlToText } from '@/shared/html-to-markdown';
import { inChunks } from '@/shared/utils';
import { fetchFile } from './download';
import { MESSAGE_KINDS, type HelpdeskConnector, type HelpdeskLookup, type HelpdeskMessage, type HelpdeskPerson, type HelpdeskTicket, type MessageKind } from './types';

const API_PATH = '/wp-json/supportcandy/v2';
const PAGE_SIZE = 50;
/** The ticket list has no status filter, so a status read pages through every status; big pages reach old open tickets in few requests. */
const LIST_PAGE_SIZE = 500;
const MAX_PAGES = 20;
/** Lookups one read puts in flight at once, so a big list doesn't flood the WordPress site. */
const CONCURRENCY = 8;

interface Credentials {
  site: string;
  username: string;
  password: string;
}

/** Endpoints differ on whether an id arrives as a number or a string, so ids are compared and keyed as strings. */
type ScId = number | string;

export interface ScTicket {
  id: ScId;
  subject?: string;
  status?: ScId;
  category?: ScId;
  customer?: ScId;
  assigned_agent?: ScId[];
  date_created?: string;
  date_updated?: string;
}

export interface ScThread {
  id: ScId;
  customer?: ScId;
  type?: string;
  body?: string | Record<string, unknown>;
  /** Comma-separated attachment ids, empty when none. */
  attachments?: string;
  date_created?: string;
}

/** `GET /attachments/<id>`; the url carries its own auth code, so it never leaves this module. */
interface ScAttachment {
  id: ScId;
  name?: string;
  url?: string;
}

interface ScPage<T> {
  total_items?: number;
  has_next_page?: boolean;
  results?: T[];
}

interface ScNamed {
  id: ScId;
  name?: string;
}

/** `GET /customers/<id>`; an agent caller sees the email too. Agents are customers as well. */
interface ScCustomer extends ScNamed {
  email?: string;
}

export interface Lookups {
  statuses: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, string>;
  agents: ReadonlyMap<string, string>;
}

/** Customer id → the person, for a ticket's requester and each thread's author. */
type People = ReadonlyMap<string, HelpdeskPerson>;

/** The default connection's site key; a named one is `SUPPORTCANDY_URL_<NAME>`, and its other keys follow. */
export const SUPPORTCANDY_URL_KEY = 'SUPPORTCANDY_URL';

const keysFor = (connection?: string) => {
  const key = (base: string): string => (connection ? suffixedKey(base, connection) : base);
  return { url: key(SUPPORTCANDY_URL_KEY), username: key('SUPPORTCANDY_USERNAME'), password: key('SUPPORTCANDY_APP_PASSWORD') };
};

/** A named connection reads only its own keys: the default ones belong to a different site. */
const credentials = (connection?: string): Credentials | null => {
  const keys = keysFor(connection);
  const site = env(keys.url)?.replace(/\/+$/, '');
  const username = env(keys.username);
  const password = env(keys.password);
  return site && username && password ? { site, username, password } : null;
};

const requireCredentials = (connection?: string): Credentials => {
  const found = credentials(connection);
  if (!found) {
    const keys = keysFor(connection);
    throw new Error(
      `SupportCandy${connection ? ` connection "${connection}"` : ''} isn't configured. Set ${keys.url} and ${keys.username} in settings.local.json env and ` +
        `${keys.password} in <HOME>/${RUNTIME_DIR}/secrets/.env (run /${pluginName()}:configure-skills → Helpdesk pack).`
    );
  }
  return found;
};

const call = async <T>(creds: Credentials, path: string, init: { method?: 'GET' | 'POST'; query?: Record<string, string | number>; form?: Record<string, string> } = {}): Promise<T> => {
  const { site, username, password } = creds;
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

export const adminLink = (site: string, id: ScId): string =>
  `${site}/wp-admin/admin.php?page=wpsc-tickets&section=ticket-list&id=${id}`;

const personOf = (people: People, id: ScId | undefined): HelpdeskPerson | undefined =>
  id === undefined ? undefined : (people.get(String(id)) ?? { id: String(id) });

export const mapTicket = (raw: ScTicket, lookups: Lookups, site: string, people: People = new Map()): HelpdeskTicket => {
  const [agent] = raw.assigned_agent ?? [];
  const requester = personOf(people, raw.customer);
  return {
    id: String(raw.id),
    helpdesk: 'supportcandy',
    subject: raw.subject ?? '',
    status: raw.status === undefined ? '' : (lookups.statuses.get(String(raw.status)) ?? String(raw.status)),
    ...(raw.category !== undefined && { category: lookups.categories.get(String(raw.category)) ?? String(raw.category) }),
    tags: [],
    ...(requester && { requester }),
    ...(agent !== undefined && { assignee: { id: String(agent), ...(lookups.agents.get(String(agent)) && { name: lookups.agents.get(String(agent)) }) } }),
    created_at: toIso(raw.date_created),
    updated_at: toIso(raw.date_updated),
    link: adminLink(site, raw.id)
  };
};

const kindOf = (thread: ScThread, ticketCustomer: ScId | undefined): MessageKind => {
  if (thread.type === 'note') {
    return MESSAGE_KINDS.note;
  }
  if (thread.type === 'log') {
    return MESSAGE_KINDS.event;
  }
  return thread.customer !== undefined && ticketCustomer !== undefined && String(thread.customer) === String(ticketCustomer)
    ? MESSAGE_KINDS.customer
    : MESSAGE_KINDS.agent;
};

export const attachmentIds = (thread: ScThread): string[] =>
  String(thread.attachments ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

export const mapThread = async (
  thread: ScThread,
  ticketCustomer: ScId | undefined,
  attachmentNames: ReadonlyMap<string, string> = new Map(),
  people: People = new Map()
): Promise<HelpdeskMessage> => ({
  id: String(thread.id),
  kind: kindOf(thread, ticketCustomer),
  ...(personOf(people, thread.customer) && { author: personOf(people, thread.customer) }),
  created_at: toIso(thread.date_created),
  body: typeof thread.body === 'string' ? await htmlToText(thread.body) : JSON.stringify(thread.body ?? {}),
  attachments: attachmentIds(thread).map((id) => ({ id, name: attachmentNames.get(id) ?? `attachment-${id}` }))
});

const lookups = async (creds: Credentials): Promise<Lookups> => {
  const [statuses, categories, agents] = await Promise.all([
    call<ScNamed[]>(creds, '/statuses'),
    call<ScNamed[]>(creds, '/categories'),
    call<ScPage<ScNamed>>(creds, '/agents', { query: { per_page: 100 } })
  ]);
  const toMap = (items: ScNamed[]): Map<string, string> => new Map(items.map((item) => [String(item.id), item.name ?? String(item.id)]));
  return { statuses: toMap(statuses), categories: toMap(categories), agents: toMap(agents.results ?? []) };
};

const people = async (creds: Credentials, ids: readonly (ScId | undefined)[]): Promise<People> => {
  const unique = [...new Set(ids.filter((id): id is ScId => id !== undefined).map(String))];
  const found = await inChunks(
    unique,
    CONCURRENCY,
    async (id): Promise<[string, HelpdeskPerson]> => {
      // A deleted customer shouldn't fail the whole read; the ticket still carries the id.
      const customer = await call<ScCustomer>(creds, `/customers/${id}`).catch((): ScCustomer => ({ id }));
      return [id, { id, ...(customer.name && { name: customer.name }), ...(customer.email && { email: customer.email }) }];
    }
  );
  return new Map(found);
};

const asLookups = (names: ReadonlyMap<string, string>): HelpdeskLookup[] => [...names].map(([id, name]) => ({ id, name }));

const allThreads = async (creds: Credentials, id: string): Promise<ScThread[]> => {
  const pages = async (page: number, gathered: ScThread[]): Promise<ScThread[]> => {
    const result = await call<ScPage<ScThread>>(creds, `/tickets/${encodeURIComponent(id)}/threads`, {
      query: { page, per_page: PAGE_SIZE, order: 'ASC' }
    });
    const next = [...gathered, ...(result.results ?? [])];
    return result.has_next_page && page < MAX_PAGES ? pages(page + 1, next) : next;
  };
  return pages(1, []);
};

/** The default connection, or a named one reading `SUPPORTCANDY_*_<NAME>` keys. */
export const supportcandy = (connection?: string): HelpdeskConnector => {
  const keys = keysFor(connection);
  const site = env(keys.url)?.replace(/\/+$/, '');
  return {
    name: 'supportcandy',
    ...(connection && { connection }),
    keys: [keys.url, keys.username, keys.password],
    ...(site && { site }),
    configured: () => credentials(connection) !== null,
    filters: new Set(),
    list: async (query) => {
      const creds = requireCredentials(connection);
      const names = await lookups(creds);
      const isFresh = (ticket: ScTicket): boolean =>
        query.updatedSince === undefined || Date.parse(toIso(ticket.date_updated) ?? '') >= Date.parse(query.updatedSince);
      const wanted = query.status?.map((status) => status.toLowerCase());
      const matches = (ticket: HelpdeskTicket): boolean => !wanted || wanted.includes(ticket.status.toLowerCase());
      const recent = async (page: number, gathered: ScTicket[]): Promise<{ found: ScTicket[]; unread: boolean }> => {
        const result = await call<ScPage<ScTicket>>(creds, '/tickets', {
          query: { page, per_page: LIST_PAGE_SIZE, orderby: 'date_updated', order: 'DESC', ...(query.search && { search: query.search }) }
        });
        const fresh = (result.results ?? []).filter(isFresh);
        const next = [...gathered, ...fresh.filter((raw) => matches(mapTicket(raw, names, creds.site)))];
        const unread = Boolean(result.has_next_page) && fresh.length === (result.results ?? []).length;
        return unread && next.length < query.limit && page < MAX_PAGES ? recent(page + 1, next) : { found: next, unread };
      };
      const { found, unread } = await recent(1, []);
      const kept = found.slice(0, query.limit);
      const requesters: People = query.people === false ? new Map() : await people(creds, kept.map((raw) => raw.customer));
      return { tickets: kept.map((raw) => mapTicket(raw, names, creds.site, requesters)), more: unread || found.length > query.limit };
    },
    get: async (id) => {
      const creds = requireCredentials(connection);
      const [raw, names, threads] = await Promise.all([
        call<ScTicket>(creds, `/tickets/${encodeURIComponent(id)}`),
        lookups(creds),
        allThreads(creds, id)
      ]);
      const ids = threads.flatMap(attachmentIds);
      const found = await inChunks(ids, CONCURRENCY, (id) => call<ScAttachment>(creds, `/attachments/${encodeURIComponent(id)}`));
      const attachmentNames = new Map(found.map((attachment) => [String(attachment.id), attachment.name ?? `attachment-${attachment.id}`]));
      const everyone = await people(creds, [raw.customer, ...threads.map((thread) => thread.customer)]);
      const messages = await Promise.all(threads.map((thread) => mapThread(thread, raw.customer, attachmentNames, everyone)));
      return { ticket: mapTicket(raw, names, creds.site, everyone), messages };
    },
    addNote: async (id, bodyHtml) => {
      const created = await call<{ id?: number } | ScThread>(requireCredentials(connection), `/tickets/${encodeURIComponent(id)}/threads`, {
        method: 'POST',
        form: { type: 'note', body: bodyHtml }
      });
      return String(created.id ?? '');
    },
    assign: async (id, teammate) => {
      const creds = requireCredentials(connection);
      const path = `/tickets/${encodeURIComponent(id)}`;
      await call<unknown>(creds, `${path}/update-fields`, { method: 'POST', form: { assigned_agent: teammate } });
      const [raw, names] = await Promise.all([call<ScTicket>(creds, path), lookups(creds)]);
      return (raw.assigned_agent ?? []).map((agent) => ({ id: String(agent), ...(names.agents.get(String(agent)) && { name: names.agents.get(String(agent)) }) }));
    },
    download: async (attachmentId) => {
      const attachment = await call<ScAttachment>(requireCredentials(connection), `/attachments/${encodeURIComponent(attachmentId)}`);
      if (!attachment.url) {
        throw new Error(`SupportCandy attachment ${attachmentId} has no download link`);
      }
      return fetchFile(attachment.url, attachment.name ?? `attachment-${attachmentId}`);
    },
    lookups: {
      statuses: async () => asLookups((await lookups(requireCredentials(connection))).statuses),
      categories: async () => asLookups((await lookups(requireCredentials(connection))).categories),
      teammates: async () => asLookups((await lookups(requireCredentials(connection))).agents)
    }
  };
};
