import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { assertFilters, connectors, noteHtml, resolveConnector } from './connectors';
import { safeName, saveToTemp } from './download';
import { issueFilter, mapAccount, mapIssue, mapMessage, pylon } from './pylon';
import { adminLink, mapThread, mapTicket, supportcandy, toIso, type Lookups } from './supportcandy';
import type { HelpdeskConnector, HelpdeskName } from './types';

const LOOKUPS: Lookups = {
  statuses: new Map([['1', 'Open'], ['4', 'Closed']]),
  categories: new Map([['2', 'Billing']]),
  agents: new Map([['5', 'Sam']])
};

describe('SupportCandy mapping', () => {
  test('UTC database dates become ISO, empty dates stay absent', () => {
    expect(toIso('2026-10-20 08:15:00')).toBe('2026-10-20T08:15:00Z');
    expect(toIso('')).toBeUndefined();
  });

  test('a ticket resolves its status, category, requester and assignee, and links to the agent view', () => {
    const ticket = mapTicket(
      { id: 318, subject: 'Export does nothing', status: 1, category: 2, customer: 77, assigned_agent: [5], date_updated: '2026-10-20 08:15:00' },
      LOOKUPS,
      'https://help.example.com',
      new Map([['77', { id: '77', name: 'Ada', email: 'ada@acme.test' }]])
    );
    expect(ticket).toMatchObject({
      id: '318',
      status: 'Open',
      category: 'Billing',
      requester: { id: '77', name: 'Ada', email: 'ada@acme.test' },
      assignee: { id: '5', name: 'Sam' },
      updated_at: '2026-10-20T08:15:00Z'
    });
    expect(ticket.link).toBe(adminLink('https://help.example.com', 318));
    expect(mapTicket({ id: 319, customer: 78 }, LOOKUPS, 'https://help.example.com').requester).toEqual({ id: '78' });
  });

  test('threads are tagged by who wrote them', async () => {
    const customer = await mapThread({ id: 1, type: 'report', customer: 77, body: '<p>Hi</p>' }, 77);
    const agent = await mapThread({ id: 2, type: 'reply', customer: 5, body: '<p>Hello</p>' }, 77);
    const note = await mapThread({ id: 3, type: 'note', customer: 5, body: '<p>Draft</p>' }, 77);
    const event = await mapThread({ id: 4, type: 'log', body: { prev: '1', new: '4' } }, 77);
    expect([customer.kind, agent.kind, note.kind, event.kind]).toEqual(['customer', 'agent', 'note', 'event']);
    expect(customer.body).toBe('Hi');
  });

  test('ids match whether an endpoint sends them as numbers or strings', async () => {
    const people = new Map([['77', { id: '77', name: 'Ada' }]]);
    const message = await mapThread({ id: '9', type: 'report', customer: '77', body: '<p>Hi</p>' }, 77, new Map(), people);
    expect(message.kind).toBe('customer');
    expect(message.author).toEqual({ id: '77', name: 'Ada' });
    expect((await mapThread({ id: 10, type: 'report', customer: 77, body: '<p>Hi</p>' }, '77')).kind).toBe('customer');
    const ticket = mapTicket({ id: '318', status: '1', category: 2, customer: 77, assigned_agent: ['5'] }, LOOKUPS, 'https://help.example.com', people);
    expect(ticket).toMatchObject({ status: 'Open', category: 'Billing', requester: { id: '77', name: 'Ada' }, assignee: { id: '5', name: 'Sam' } });
  });
});

describe('SupportCandy notes', () => {
  const saved = { ...process.env };
  const sent: { url: string; body: string }[] = [];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.SUPPORTCANDY_URL = 'https://help.example.com/';
    process.env.SUPPORTCANDY_USERNAME = 'agent-bot';
    process.env.SUPPORTCANDY_APP_PASSWORD = 'abcd efgh';
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(input), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ id: 9 }), { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...saved };
    sent.length = 0;
  });

  test('a note is posted as a private note, never a reply', async () => {
    expect(await supportcandy().addNote('318', '<p>Draft</p>')).toBe('9');
    const [request] = sent;
    expect(request?.url).toBe('https://help.example.com/wp-json/supportcandy/v2/tickets/318/threads');
    const form = new URLSearchParams(request?.body);
    expect(form.get('type')).toBe('note');
    expect(form.get('body')).toBe('<p>Draft</p>');
  });
});

describe('Pylon mapping', () => {
  test('an issue keeps its state, tags and requester', () => {
    const ticket = mapIssue({ id: 'iss_1', title: 'Export broken', state: 'new', tags: ['bug'], requester: { id: 'c1', email: 'ada@acme.test' } });
    expect(ticket).toMatchObject({ id: 'iss_1', subject: 'Export broken', status: 'new', tags: ['bug'], requester: { id: 'c1', email: 'ada@acme.test' } });
  });

  test('messages are tagged note, customer or agent', async () => {
    const kinds = await Promise.all(
      [
        { id: 'm1', is_private: true, author: { user: { id: 'u1' } } },
        { id: 'm2', author: { contact: { id: 'c1', email: 'ada@acme.test' } } },
        { id: 'm3', author: { user: { id: 'u1' } } }
      ].map(async (message) => (await mapMessage(message)).kind)
    );
    expect(kinds).toEqual(['note', 'customer', 'agent']);
  });

  test('an issue carries its number, assignee, account, linked issues and CSAT', () => {
    const ticket = mapIssue({
      id: 'iss_2',
      number: 41,
      title: 'Export stuck',
      state: 'waiting_on_you',
      assignee: { id: 'usr_9', email: 'sam@acme.test' },
      account: { id: 'acc_3' },
      latest_message_activity_at: '2026-10-20T09:00:00Z',
      external_issues: [{ source: 'github', external_id: '12', link: 'https://github.com/acme/app/issues/12' }],
      csat_responses: [{ score: 4, comment: 'Quick fix' }]
    });
    expect(ticket).toMatchObject({
      number: 41,
      assignee: { id: 'usr_9', email: 'sam@acme.test' },
      account: 'acc_3',
      last_activity_at: '2026-10-20T09:00:00Z',
      linked_issues: [{ source: 'github', id: '12', url: 'https://github.com/acme/app/issues/12' }],
      csat: [{ score: 4, comment: 'Quick fix' }]
    });
    expect(mapIssue({ id: 'iss_3' })).not.toHaveProperty('linked_issues');
  });

  test('an account keeps its name, domains, tags and owner', () => {
    const account = mapAccount({ id: 'acc_3', name: 'Acme', primary_domain: 'acme.test', domains: ['acme.test', 'acme.example'], owner: { id: 'usr_9', email: 'sam@acme.test' } });
    expect(account).toEqual({ id: 'acc_3', name: 'Acme', domains: ['acme.test', 'acme.example'], tags: [], owner: { id: 'usr_9', email: 'sam@acme.test' } });
  });

  test('a message names its author', async () => {
    const message = await mapMessage({ id: 'm2', author: { name: 'Ada', contact: { id: 'c1', email: 'ada@acme.test' } } });
    expect(message.author).toEqual({ id: 'c1', email: 'ada@acme.test', name: 'Ada' });
    expect(await mapMessage({ id: 'm3', author: {} })).not.toHaveProperty('author');
  });

  test('tags, account and assignee become AND-ed leaves; no window and no filter means no filter', () => {
    expect(issueFilter({})).toBeUndefined();
    expect(issueFilter({ status: ['new'] })).toEqual({ field: 'state', operator: 'equals', value: 'new' });
    expect(issueFilter({ tags: ['bug', 'ios'], account: 'acc_3', assignee: 'usr_9' })).toEqual({
      operator: 'and',
      subfilters: [
        { field: 'tags', operator: 'contains', value: 'bug' },
        { field: 'tags', operator: 'contains', value: 'ios' },
        { field: 'account_id', operator: 'equals', value: 'acc_3' },
        { field: 'assignee_id', operator: 'equals', value: 'usr_9' }
      ]
    });
  });

  test('the filter bounds on update time and ORs the states', () => {
    expect(issueFilter({ updatedSince: '2026-10-13T00:00:00.000Z' })).toEqual({
      field: 'updated_at',
      operator: 'time_is_after',
      value: '2026-10-13T00:00:00.000Z'
    });
    expect(issueFilter({ updatedSince: '2026-10-13T00:00:00.000Z', status: ['new', 'waiting_on_you'] })).toMatchObject({
      operator: 'and',
      subfilters: [{ field: 'updated_at' }, { operator: 'or', subfilters: [{ value: 'new' }, { value: 'waiting_on_you' }] }]
    });
  });
});

describe('resolveConnector', () => {
  const fake = (name: HelpdeskName, connection?: string): HelpdeskConnector => ({
    name,
    ...(connection && { connection }),
    keys: [],
    configured: () => true,
    filters: new Set(),
    lookups: {},
    list: async () => [],
    get: async () => {
      throw new Error('unused');
    },
    addNote: async () => '',
    download: async () => {
      throw new Error('unused');
    }
  });
  const label = (connector: HelpdeskConnector): string => `${connector.name}:${connector.connection ?? 'default'}`;

  test('no connection named means the default, or the only connection there is', () => {
    expect(label(resolveConnector({}, [fake('supportcandy'), fake('supportcandy', 'acme_shop')]))).toBe('supportcandy:default');
    expect(label(resolveConnector({}, [fake('pylon', 'acme')]))).toBe('pylon:acme');
    expect(label(resolveConnector({ helpdesk: 'pylon' }, [fake('supportcandy'), fake('pylon')]))).toBe('pylon:default');
  });

  test('a named connection matches however its name is written, and never falls back to the default', () => {
    expect(label(resolveConnector({ connection: 'acme-shop' }, [fake('supportcandy'), fake('supportcandy', 'acme_shop')]))).toBe(
      'supportcandy:acme_shop'
    );
    expect(() => resolveConnector({ helpdesk: 'pylon', connection: 'beta' }, [fake('pylon')])).toThrow(
      'The "beta" connection isn\'t fully set up: it needs PYLON_API_TOKEN_BETA'
    );
  });

  test('refuses to guess between several, and says when nothing is configured', () => {
    expect(() => resolveConnector({}, [fake('supportcandy'), fake('pylon')])).toThrow('Several helpdesk connections are configured (supportcandy, pylon)');
    expect(() => resolveConnector({}, [fake('pylon', 'acme'), fake('pylon', 'beta')])).toThrow('pylon:acme, pylon:beta');
    expect(() => resolveConnector({ connection: 'acme' }, [fake('pylon', 'acme'), fake('supportcandy', 'acme')])).toThrow('pass helpdesk');
    expect(() => resolveConnector({}, [])).toThrow('No helpdesk is configured');
  });
});

describe('named connections', () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const auth: string[] = [];

  beforeEach(() => {
    process.env.PYLON_API_TOKEN = 'default-token';
    process.env.PYLON_API_TOKEN_ACME = 'acme-token';
    process.env.SUPPORTCANDY_URL_SHOP = 'https://shop.example.com';
    process.env.SUPPORTCANDY_USERNAME_SHOP = 'agent-bot';
    process.env.SUPPORTCANDY_APP_PASSWORD_SHOP = 'shop pass';
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      auth.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response(JSON.stringify({ data: [] }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...saved };
    auth.length = 0;
  });

  test('every configured connection is found, defaults first', () => {
    expect(connectors().map((connector) => `${connector.name}:${connector.connection ?? 'default'}`)).toEqual([
      'supportcandy:shop',
      'pylon:default',
      'pylon:acme'
    ]);
    expect(connectors()[0]?.site).toBe('https://shop.example.com');
  });

  test("a Pylon call carries its own connection's token", async () => {
    await pylon('acme').list({ limit: 1 });
    await pylon().list({ limit: 1 });
    expect(auth).toEqual(['Bearer acme-token', 'Bearer default-token']);
  });

  test('a named SupportCandy connection reads only its own keys', () => {
    expect(supportcandy('shop').configured()).toBe(true);
    expect(supportcandy().configured()).toBe(false);
    expect(supportcandy('shop').keys).toEqual(['SUPPORTCANDY_URL_SHOP', 'SUPPORTCANDY_USERNAME_SHOP', 'SUPPORTCANDY_APP_PASSWORD_SHOP']);
  });
});

describe('assertFilters', () => {
  test('refuses a filter the helpdesk cannot apply, allows one it can', () => {
    expect(() => assertFilters(supportcandy(), { tags: ['bug'] })).toThrow("supportcandy can't filter tickets by tags");
    expect(() => assertFilters(supportcandy(), { tags: [], assignee: undefined })).not.toThrow();
    expect(() => assertFilters(pylon(), { tags: ['bug'], account: 'acc_3', assignee: 'usr_9' })).not.toThrow();
  });
});

describe('Pylon lookups', () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.PYLON_API_TOKEN = 'test-token';
    globalThis.fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === '/issues/iss_7') {
        return new Response(JSON.stringify({ data: { id: 'iss_7', title: 'Crash', body_html: '<p>It crashes on launch.</p>' } }));
      }
      if (path === '/issues/iss_7/messages') {
        return new Response(JSON.stringify({ data: [{ id: 'm1', author: { name: 'Sam', user: { id: 'usr_9' } }, message_html: '<p>Looking.</p>' }] }));
      }
      const data =
        path === '/users'
          ? [{ id: 'usr_9', name: 'Sam', email: 'sam@acme.test' }]
          : path === '/tags'
            ? [{ id: 't1', value: 'bug', object_type: 'issue' }, { id: 't2', value: 'vip', object_type: 'account' }]
            : [{ id: 'mac_1', name: 'Refund', text_html: '<p>We have refunded you.</p>' }];
      return new Response(JSON.stringify({ data }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...saved };
  });

  test('teammates come back with their email', async () => {
    const teammates = await pylon().lookups.teammates?.();
    expect(teammates).toEqual([{ id: 'usr_9', name: 'Sam', email: 'sam@acme.test' }]);
  });

  test("a ticket read carries the issue's opening body beside the thread", async () => {
    const { ticket, messages } = await pylon().get('iss_7');
    expect(ticket.body).toBe('It crashes on launch.');
    expect(messages[0]?.author).toEqual({ id: 'usr_9', name: 'Sam' });
  });

  test('tags are the issue tags; macros carry plain text', async () => {
    expect(await pylon().lookups.tags?.()).toEqual([{ id: 't1', name: 'bug' }]);
    expect(await pylon().lookups.macros?.()).toEqual([{ id: 'mac_1', name: 'Refund', text: 'We have refunded you.' }]);
  });
});

describe('noteHtml', () => {
  test('escapes markup and turns blank lines into paragraphs', () => {
    expect(noteHtml('Hi <b>there</b>\n\nLine one\nline two')).toBe('<p>Hi &lt;b&gt;there&lt;/b&gt;</p><p>Line one<br>line two</p>');
  });
});

describe('attachments', () => {
  test('SupportCandy threads list their attachments by id and resolved name', async () => {
    const message = await mapThread({ id: 1, type: 'report', customer: 77, body: '<p>Log attached</p>', attachments: '12, 13' }, 77, new Map([['12', 'acme.log']]));
    expect(message.attachments).toEqual([
      { id: '12', name: 'acme.log' },
      { id: '13', name: 'attachment-13' }
    ]);
    expect((await mapThread({ id: 2, type: 'reply', attachments: '' }, 77)).attachments).toEqual([]);
  });

  test('Pylon messages list their files by URL and file name', async () => {
    const message = await mapMessage({ id: 'm1', file_urls: ['https://files.example.com/a/watch%20shot.png?sig=1'] });
    expect(message.attachments).toEqual([{ id: 'https://files.example.com/a/watch%20shot.png?sig=1', name: 'watch shot.png' }]);
  });

  test('a saved attachment lands in a fresh temp folder under a name that cannot climb out', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd');
    expect(safeName('.hidden')).toBe('hidden');
    const path = saveToTemp({ name: '../watch.png', contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    expect(path.startsWith(tmpdir())).toBe(true);
    expect(path.endsWith('watch.png')).toBe(true);
    expect(readFileSync(path).byteLength).toBe(3);
  });
});

describe('SupportCandy downloads', () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const asked: string[] = [];

  beforeEach(() => {
    process.env.SUPPORTCANDY_URL = 'https://help.example.com';
    process.env.SUPPORTCANDY_USERNAME = 'agent-bot';
    process.env.SUPPORTCANDY_APP_PASSWORD = 'abcd efgh';
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      return url.includes('/wp-json/supportcandy/v2/attachments/12')
        ? new Response(JSON.stringify({ id: 12, name: 'acme.log', url: 'https://help.example.com/?wpsc_attachment=12&user=3&auth_code=secret' }))
        : new Response('log line', { headers: { 'content-type': 'text/plain' } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...saved };
    asked.length = 0;
  });

  test('follows the signed link but returns only the file', async () => {
    const file = await supportcandy().download('12');
    expect(asked).toEqual(['https://help.example.com/wp-json/supportcandy/v2/attachments/12', 'https://help.example.com/?wpsc_attachment=12&user=3&auth_code=secret']);
    expect(file.name).toBe('acme.log');
    expect(new TextDecoder().decode(file.bytes)).toBe('log line');
    expect(JSON.stringify(file)).not.toContain('auth_code');
  });
});

describe('SupportCandy status filter', () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.SUPPORTCANDY_URL = 'https://help.example.com';
    process.env.SUPPORTCANDY_USERNAME = 'agent-bot';
    process.env.SUPPORTCANDY_APP_PASSWORD = 'abcd efgh';
    const recent = '2026-10-20 08:00:00';
    const pages: Record<string, unknown> = {
      '1': { has_next_page: true, results: [{ id: 1, status: 1, date_updated: recent }, { id: 2, status: 1, date_updated: recent }] },
      '2': { has_next_page: false, results: [{ id: 3, status: 4, date_updated: recent }] }
    };
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const body = url.pathname.endsWith('/statuses')
        ? [{ id: 1, name: 'Open' }, { id: 4, name: 'Closed' }]
        : url.pathname.endsWith('/categories')
          ? []
          : url.pathname.endsWith('/tickets')
            ? pages[url.searchParams.get('page') ?? '1']
            : { results: [] };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...saved };
  });

  test('keeps paging until it has enough tickets in the wanted status', async () => {
    const tickets = await supportcandy().list({ updatedSince: '2026-10-13T00:00:00Z', status: ['Closed'], limit: 2 });
    expect(tickets.map((ticket) => ticket.id)).toEqual(['3']);
  });
});

describe('SupportCandy with no window', () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.SUPPORTCANDY_URL = 'https://help.example.com';
    process.env.SUPPORTCANDY_USERNAME = 'agent-bot';
    process.env.SUPPORTCANDY_APP_PASSWORD = 'abcd efgh';
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const path = url.pathname.replace('/wp-json/supportcandy/v2', '');
      const body =
        path === '/statuses'
          ? [{ id: 1, name: 'Open' }]
          : path === '/categories'
            ? [{ id: 2, name: 'Billing' }]
            : path === '/agents'
              ? { results: [{ id: 5, name: 'Sam' }] }
              : path === '/customers/77'
                ? { id: 77, name: 'Ada', email: 'ada@acme.test' }
                : path === '/tickets'
                  ? { has_next_page: false, results: [{ id: 5, status: 1, customer: 77, date_updated: '2025-01-02 03:04:05' }, { id: 6, status: 1, customer: 404 }] }
                  : null;
      if (body === null) {
        return new Response('{"code":"invalid_id"}', { status: 400 });
      }
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...saved };
  });

  test('an old or undated open ticket still counts, with its requester resolved or kept as an id', async () => {
    const tickets = await supportcandy().list({ status: ['Open'], limit: 10 });
    expect(tickets.map((ticket) => ticket.id)).toEqual(['5', '6']);
    expect(tickets.map((ticket) => ticket.requester)).toEqual([{ id: '77', name: 'Ada', email: 'ada@acme.test' }, { id: '404' }]);
  });

  test('statuses and categories are the lookups', async () => {
    expect(await supportcandy().lookups.statuses?.()).toEqual([{ id: '1', name: 'Open' }]);
    expect(await supportcandy().lookups.categories?.()).toEqual([{ id: '2', name: 'Billing' }]);
    expect(await supportcandy().lookups.teammates?.()).toEqual([{ id: '5', name: 'Sam' }]);
    expect(supportcandy().lookups.tags).toBeUndefined();
  });
});
