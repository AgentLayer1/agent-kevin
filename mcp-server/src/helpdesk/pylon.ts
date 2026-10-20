/**
 * Pylon connector — maps the Pylon client's issues and messages into the
 * helpdesk shape. Requester and contact details stay behind; a message's
 * author only decides its kind.
 */
import { addNote, getIssue, getIssueMessages, searchIssues, type IssueFilter } from '@/pylon/client';
import { env } from '@/shared/env';
import { htmlToText } from '@/pylon/format';
import { fetchFile } from './download';
import type { PylonIssue, PylonMessage } from '@/pylon/types';
import { MESSAGE_KINDS, type HelpdeskConnector, type HelpdeskMessage, type HelpdeskTicket, type MessageKind, type TicketQuery } from './types';

const LIST_PREVIEW_CHARS = 400;

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export const mapIssue = async (issue: PylonIssue, preview: boolean): Promise<HelpdeskTicket> => {
  const body = await htmlToText(issue.body_html);
  return {
    id: issue.id,
    helpdesk: 'pylon',
    subject: issue.title ?? '',
    status: issue.state ?? '',
    tags: issue.tags ?? [],
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    ...(issue.link && { link: issue.link }),
    body: preview ? truncate(body, LIST_PREVIEW_CHARS) : body
  };
};

const kindOf = (message: PylonMessage): MessageKind => {
  if (message.is_private) {
    return MESSAGE_KINDS.note;
  }
  return message.author?.contact ? MESSAGE_KINDS.customer : MESSAGE_KINDS.agent;
};

const fileName = (url: string): string => {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '') || 'attachment';
  } catch {
    return 'attachment';
  }
};

export const mapMessage = async (message: PylonMessage): Promise<HelpdeskMessage> => ({
  id: message.id,
  kind: kindOf(message),
  created_at: message.timestamp,
  body: await htmlToText(message.message_html),
  attachments: (message.file_urls ?? []).map((url) => ({ id: url, name: fileName(url) }))
});

export const issueFilter = (query: Pick<TicketQuery, 'updatedSince' | 'status'>): IssueFilter => {
  const since: IssueFilter = { field: 'updated_at', operator: 'time_is_after', value: query.updatedSince };
  const states = (query.status ?? []).map((state): IssueFilter => ({ field: 'state', operator: 'equals', value: state }));
  const [first, ...rest] = states;
  if (!first) {
    return since;
  }
  return { operator: 'and', subfilters: [since, rest.length > 0 ? { operator: 'or', subfilters: states } : first] };
};

export const pylon: HelpdeskConnector = {
  name: 'pylon',
  configured: () => Boolean(env('PYLON_API_TOKEN')),
  list: async (query) => {
    const page = await searchIssues({ filter: issueFilter(query), ...(query.search && { search_text: query.search }), limit: query.limit });
    return Promise.all(page.issues.map((issue) => mapIssue(issue, true)));
  },
  get: async (id) => {
    const [issue, messages] = await Promise.all([getIssue(id), getIssueMessages(id)]);
    return { ticket: await mapIssue(issue, false), messages: await Promise.all(messages.map(mapMessage)) };
  },
  addNote: async (id, bodyHtml) => (await addNote(id, bodyHtml)).id,
  download: async (attachmentId) => {
    if (!attachmentId.startsWith('https://')) {
      throw new Error('A Pylon attachment id is the https file URL helpdesk_ticket listed.');
    }
    return fetchFile(attachmentId, fileName(attachmentId));
  }
};
