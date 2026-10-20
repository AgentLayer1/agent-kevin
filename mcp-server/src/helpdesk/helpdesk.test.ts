import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { noteHtml, resolveConnector } from './connectors';
import { safeName, saveToTemp } from './download';
import { issueFilter, mapIssue, mapMessage } from './pylon';
import { adminLink, mapThread, mapTicket, supportcandy, toIso, type Lookups } from './supportcandy';
import type { HelpdeskConnector, HelpdeskName } from './types';

const LOOKUPS: Lookups = {
  statuses: new Map([[1, 'Open'], [4, 'Closed']]),
  categories: new Map([[2, 'Watch']])
};

describe('SupportCandy mapping', () => {
  test('UTC database dates become ISO, empty dates stay absent', () => {
    expect(toIso('2026-10-20 08:15:00')).toBe('2026-10-20T08:15:00Z');
    expect(toIso('')).toBeUndefined();
  });

  test('a ticket resolves its status and category names and links to the agent view', () => {
    const ticket = mapTicket(
      { id: 1042, subject: 'Adhan silent', status: 1, category: 2, customer: 77, date_updated: '2026-10-20 08:15:00' },
      LOOKUPS,
      'https://help.example.com'
    );
    expect(ticket).toMatchObject({ id: '1042', status: 'Open', category: 'Watch', updated_at: '2026-10-20T08:15:00Z' });
    expect(ticket.link).toBe(adminLink('https://help.example.com', 1042));
    expect(JSON.stringify(ticket)).not.toContain('77');
  });

  test('threads are tagged by who wrote them', async () => {
    const customer = await mapThread({ id: 1, type: 'report', customer: 77, body: '<p>Hi</p>' }, 77);
    const agent = await mapThread({ id: 2, type: 'reply', customer: 5, body: '<p>Hello</p>' }, 77);
    const note = await mapThread({ id: 3, type: 'note', customer: 5, body: '<p>Draft</p>' }, 77);
    const event = await mapThread({ id: 4, type: 'log', body: { prev: '1', new: '4' } }, 77);
    expect([customer.kind, agent.kind, note.kind, event.kind]).toEqual(['customer', 'agent', 'note', 'event']);
    expect(customer.body).toBe('Hi');
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
    expect(await supportcandy.addNote('1042', '<p>Draft</p>')).toBe('9');
    const [request] = sent;
    expect(request?.url).toBe('https://help.example.com/wp-json/supportcandy/v2/tickets/1042/threads');
    const form = new URLSearchParams(request?.body);
    expect(form.get('type')).toBe('note');
    expect(form.get('body')).toBe('<p>Draft</p>');
  });
});

describe('Pylon mapping', () => {
  test('an issue keeps its state and tags and drops the requester', () => {
    const ticket = mapIssue({ id: 'iss_1', title: 'Export broken', state: 'new', tags: ['bug'], requester: { email: 'ada@acme.test' } });
    expect(ticket).toMatchObject({ id: 'iss_1', subject: 'Export broken', status: 'new', tags: ['bug'] });
    expect(JSON.stringify(ticket)).not.toContain('ada@acme.test');
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
  const fake = (name: HelpdeskName, configured: boolean): HelpdeskConnector => ({
    name,
    configured: () => configured,
    list: async () => [],
    get: async () => {
      throw new Error('unused');
    },
    addNote: async () => '',
    download: async () => {
      throw new Error('unused');
    }
  });

  test('picks the only configured helpdesk, or the one named', () => {
    expect(resolveConnector(undefined, { supportcandy: fake('supportcandy', true), pylon: fake('pylon', false) }).name).toBe('supportcandy');
    expect(resolveConnector('pylon', { supportcandy: fake('supportcandy', true), pylon: fake('pylon', true) }).name).toBe('pylon');
  });

  test('refuses to guess between several, and names an unconfigured one', () => {
    expect(() => resolveConnector(undefined, { supportcandy: fake('supportcandy', true), pylon: fake('pylon', true) })).toThrow(/Several/);
    expect(() => resolveConnector('pylon', { supportcandy: fake('supportcandy', true), pylon: fake('pylon', false) })).toThrow(/isn't configured/);
    expect(() => resolveConnector(undefined, { supportcandy: fake('supportcandy', false), pylon: fake('pylon', false) })).toThrow(/No helpdesk/);
  });
});

describe('noteHtml', () => {
  test('escapes markup and turns blank lines into paragraphs', () => {
    expect(noteHtml('Hi <b>there</b>\n\nLine one\nline two')).toBe('<p>Hi &lt;b&gt;there&lt;/b&gt;</p><p>Line one<br>line two</p>');
  });
});

describe('attachments', () => {
  test('SupportCandy threads list their attachments by id and resolved name', async () => {
    const message = await mapThread({ id: 1, type: 'report', customer: 77, body: '<p>Log attached</p>', attachments: '12, 13' }, 77, new Map([['12', 'praywatch.log']]));
    expect(message.attachments).toEqual([
      { id: '12', name: 'praywatch.log' },
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
        ? new Response(JSON.stringify({ id: 12, name: 'praywatch.log', url: 'https://help.example.com/?wpsc_attachment=12&user=3&auth_code=secret' }))
        : new Response('log line', { headers: { 'content-type': 'text/plain' } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...saved };
    asked.length = 0;
  });

  test('follows the signed link but returns only the file', async () => {
    const file = await supportcandy.download('12');
    expect(asked).toEqual(['https://help.example.com/wp-json/supportcandy/v2/attachments/12', 'https://help.example.com/?wpsc_attachment=12&user=3&auth_code=secret']);
    expect(file.name).toBe('praywatch.log');
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
    const tickets = await supportcandy.list({ updatedSince: '2026-10-13T00:00:00Z', status: ['Closed'], limit: 2 });
    expect(tickets.map((ticket) => ticket.id)).toEqual(['3']);
  });
});
