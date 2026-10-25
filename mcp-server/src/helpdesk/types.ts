/**
 * The helpdesk shape every connector maps into. It carries the people on a
 * ticket (requester, assignee, each message's author) because finding the
 * customer and answering them by name is the work.
 */

export const HELPDESKS = ['supportcandy', 'pylon'] as const;
export type HelpdeskName = (typeof HELPDESKS)[number];

export interface HelpdeskPerson {
  id?: string;
  name?: string;
  email?: string;
}

export interface HelpdeskTicket {
  id: string;
  helpdesk: HelpdeskName;
  number?: number;
  subject: string;
  status: string;
  category?: string;
  tags: string[];
  requester?: HelpdeskPerson;
  /** Absent when unassigned. */
  assignee?: HelpdeskPerson;
  /** Account (customer company) id. */
  account?: string;
  created_at?: string;
  updated_at?: string;
  last_activity_at?: string;
  /** Agent-side link; never a customer link that carries its own auth. */
  link?: string;
  /** The opening message, when the helpdesk keeps it apart from the thread (helpdesk_ticket only). */
  body?: string;
  /** Engineering issues the ticket is linked to. */
  linked_issues?: Array<{ source?: string; id?: string; url?: string }>;
  csat?: Array<{ score?: number; comment?: string }>;
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
  author?: HelpdeskPerson;
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
  /** Look up each requester's name and email. Default true. */
  people?: boolean;
}

export interface TicketList {
  tickets: HelpdeskTicket[];
  /** The read stopped before the end: at `limit`, or at the page backstop. */
  more: boolean;
}

export interface HelpdeskAccount {
  id: string;
  name: string;
  domains: string[];
  tags: string[];
  owner?: HelpdeskPerson;
}

export const LOOKUP_KINDS = ['statuses', 'categories', 'tags', 'teammates', 'macros'] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];

export interface HelpdeskLookup {
  id: string;
  name: string;
  /** A teammate's email. */
  email?: string;
  /** A macro's text. */
  text?: string;
}

export interface HelpdeskConnector {
  name: HelpdeskName;
  /** A named connection (`<KEY>_<NAME>` keys); absent for the default one. */
  connection?: string;
  /** The keys this connection reads, for errors and setup. */
  keys: readonly string[];
  /** The site it talks to, when that isn't a secret. */
  site?: string;
  configured: () => boolean;
  /** The TicketQuery filters beyond status and search this helpdesk can apply. */
  filters: ReadonlySet<TicketFilter>;
  list: (query: TicketQuery) => Promise<TicketList>;
  get: (id: string) => Promise<{ ticket: HelpdeskTicket; messages: HelpdeskMessage[] }>;
  /** Adds a note only agents can see; returns the new note's id. */
  addNote: (id: string, bodyHtml: string) => Promise<string>;
  /** Assigns the ticket to one teammate; returns everyone assigned as the ticket reads back after the change. */
  assign?: (id: string, teammate: string) => Promise<HelpdeskPerson[]>;
  download: (attachmentId: string) => Promise<DownloadedFile>;
  accounts?: (search?: string) => Promise<HelpdeskAccount[]>;
  lookups: Partial<Record<LookupKind, () => Promise<HelpdeskLookup[]>>>;
}
