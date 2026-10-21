/**
 * Pylon connector — maps the Pylon client's issues and messages into the
 * helpdesk shape.
 */
import { addNote, getIssue, getIssueMessages, listAccounts, listMacros, listTags, listUsers, searchIssues, type IssueFilter } from '@/pylon/client';
import { env } from '@/shared/env';
import { htmlToText } from '@/shared/html-to-markdown';
import { fetchFile } from './download';
import type { PylonAccount, PylonIssue, PylonMessage } from '@/pylon/types';
import { MESSAGE_KINDS, type HelpdeskAccount, type HelpdeskConnector, type HelpdeskMessage, type HelpdeskPerson, type HelpdeskTicket, type MessageKind, type TicketQuery } from './types';

const person = (who: { id?: string; email?: string } | undefined): HelpdeskPerson | undefined =>
  who?.id || who?.email ? { ...(who.id && { id: who.id }), ...(who.email && { email: who.email }) } : undefined;

export const mapIssue = (issue: PylonIssue): HelpdeskTicket => ({
  id: issue.id,
  helpdesk: 'pylon',
  ...(issue.number !== undefined && { number: issue.number }),
  subject: issue.title ?? '',
  status: issue.state ?? '',
  tags: issue.tags ?? [],
  ...(person(issue.requester) && { requester: person(issue.requester) }),
  ...(person(issue.assignee) && { assignee: person(issue.assignee) }),
  ...(issue.account?.id && { account: issue.account.id }),
  created_at: issue.created_at,
  updated_at: issue.updated_at,
  ...(issue.latest_message_activity_at && { last_activity_at: issue.latest_message_activity_at }),
  ...(issue.link && { link: issue.link }),
  ...(issue.external_issues?.length && {
    linked_issues: issue.external_issues.map((linked) => ({ source: linked.source, id: linked.external_id, url: linked.link }))
  }),
  ...(issue.csat_responses?.length && { csat: issue.csat_responses })
});

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
  ...(message.author && {
    author: {
      ...person(message.author.user ?? message.author.contact),
      ...(message.author.name && { name: message.author.name })
    }
  }),
  created_at: message.timestamp,
  body: await htmlToText(message.message_html),
  attachments: (message.file_urls ?? []).map((url) => ({ id: url, name: fileName(url) }))
});

/** Documented leaf shapes only (`equals`, `contains`, `time_is_after`), AND-ed; several states are an OR. */
export const issueFilter = (query: Omit<TicketQuery, 'search' | 'limit'>): IssueFilter | undefined => {
  const states = (query.status ?? []).map((state): IssueFilter => ({ field: 'state', operator: 'equals', value: state }));
  const leaves: IssueFilter[] = [
    ...(query.updatedSince ? [{ field: 'updated_at', operator: 'time_is_after', value: query.updatedSince }] : []),
    ...(states.length > 1 ? [{ operator: 'or', subfilters: states }] : states),
    ...(query.tags ?? []).map((tag): IssueFilter => ({ field: 'tags', operator: 'contains', value: tag })),
    ...(query.account ? [{ field: 'account_id', operator: 'equals', value: query.account }] : []),
    ...(query.assignee ? [{ field: 'assignee_id', operator: 'equals', value: query.assignee }] : [])
  ];
  return leaves.length > 1 ? { operator: 'and', subfilters: leaves } : leaves[0];
};

export const mapAccount = (account: PylonAccount): HelpdeskAccount => ({
  id: account.id,
  name: account.name ?? '',
  domains: [...new Set([account.primary_domain, account.domain, ...(account.domains ?? [])])].filter((domain): domain is string => Boolean(domain)),
  tags: account.tags ?? [],
  ...(person(account.owner) && { owner: person(account.owner) })
});

export const pylon: HelpdeskConnector = {
  name: 'pylon',
  configured: () => Boolean(env('PYLON_API_TOKEN')),
  filters: new Set(['tags', 'assignee', 'account']),
  list: async (query) => {
    const filter = issueFilter(query);
    const page = await searchIssues({ ...(filter && { filter }), ...(query.search && { search_text: query.search }), limit: query.limit });
    return page.issues.map(mapIssue);
  },
  get: async (id) => {
    const [issue, messages] = await Promise.all([getIssue(id), getIssueMessages(id)]);
    const body = await htmlToText(issue.body_html);
    return { ticket: { ...mapIssue(issue), ...(body && { body }) }, messages: await Promise.all(messages.map(mapMessage)) };
  },
  addNote: async (id, bodyHtml) => (await addNote(id, bodyHtml)).id,
  download: async (attachmentId) => {
    if (!attachmentId.startsWith('https://')) {
      throw new Error('A Pylon attachment id is the https file URL helpdesk_ticket listed.');
    }
    return fetchFile(attachmentId, fileName(attachmentId));
  },
  accounts: async (search) => {
    const accounts = (await listAccounts()).map(mapAccount);
    const needle = search?.toLowerCase();
    return needle ? accounts.filter((account) => [account.name, ...account.domains].some((field) => field.toLowerCase().includes(needle))) : accounts;
  },
  lookups: {
    tags: async () =>
      (await listTags()).filter((tag) => !tag.object_type || tag.object_type === 'issue').map((tag) => ({ id: tag.id, name: tag.value ?? tag.id })),
    teammates: async () => (await listUsers()).map((user) => ({ id: user.id, name: user.name ?? user.id, ...(user.email && { email: user.email }) })),
    macros: async () =>
      Promise.all((await listMacros()).map(async (macro) => ({ id: macro.id, name: macro.name ?? macro.id, text: await htmlToText(macro.text_html) })))
  }
};
