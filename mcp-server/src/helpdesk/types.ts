/**
 * The helpdesk shape every connector maps into. Requester identity (name,
 * email, contact ids) is never part of it: tickets reach the model as text to
 * sort and answer, not as personal data.
 */

export const HELPDESKS = ['supportcandy', 'pylon'] as const;
export type HelpdeskName = (typeof HELPDESKS)[number];

export interface HelpdeskTicket {
  id: string;
  helpdesk: HelpdeskName;
  number?: number;
  subject: string;
  status: string;
  category?: string;
  tags: string[];
  /** Teammate id, never an email; absent when unassigned or the helpdesk has no assignee. */
  assignee?: string;
  /** Account (customer company) id. */
  account?: string;
  created_at?: string;
  updated_at?: string;
  last_activity_at?: string;
  /** Agent-side link; never a customer link that carries its own auth. */
  link?: string;
}

export const MESSAGE_KINDS = {
  customer: 'customer',
  agent: 'agent',
  note: 'note',
  event: 'event'
} as const;
export type MessageKind = (typeof MESSAGE_KINDS)[keyof typeof MESSAGE_KINDS];

export interface HelpdeskAttachment {
  /** What helpdesk_attachment takes to download it. */
  id: string;
  name: string;
}

export interface HelpdeskMessage {
  id: string;
  kind: MessageKind;
  created_at?: string;
  body: string;
  attachments: HelpdeskAttachment[];
}

export interface DownloadedFile {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export const TICKET_FILTERS = ['tags', 'assignee', 'account'] as const;
export type TicketFilter = (typeof TICKET_FILTERS)[number];

export interface TicketQuery {
  /** ISO time; tickets updated at or after it. Absent means any age. */
  updatedSince?: string;
  status?: readonly string[];
  search?: string;
  tags?: readonly string[];
  assignee?: string;
  account?: string;
  limit: number;
}

export interface HelpdeskAccount {
  id: string;
  name: string;
  domains: string[];
  tags: string[];
}

export const LOOKUP_KINDS = ['statuses', 'categories', 'tags', 'teammates', 'macros'] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

export interface HelpdeskLookup {
  id: string;
  name: string;
  /** A macro's text. */
  text?: string;
}

export interface HelpdeskConnector {
  name: HelpdeskName;
  configured: () => boolean;
  /** The TicketQuery filters beyond status and search this helpdesk can apply. */
  filters: ReadonlySet<TicketFilter>;
  list: (query: TicketQuery) => Promise<HelpdeskTicket[]>;
  get: (id: string) => Promise<{ ticket: HelpdeskTicket; messages: HelpdeskMessage[] }>;
  /** Adds a note only agents can see; returns the new note's id. */
  addNote: (id: string, bodyHtml: string) => Promise<string>;
  download: (attachmentId: string) => Promise<DownloadedFile>;
  accounts?: (search?: string) => Promise<HelpdeskAccount[]>;
  lookups: Partial<Record<LookupKind, () => Promise<HelpdeskLookup[]>>>;
}
