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
  subject: string;
  status: string;
  category?: string;
  tags: string[];
  created_at?: string;
  updated_at?: string;
  /** Agent-side link; never a customer link that carries its own auth. */
  link?: string;
  /** The opening message, trimmed for a list or whole for a single ticket. */
  body: string;
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

export interface TicketQuery {
  /** ISO time; tickets updated at or after it. */
  updatedSince: string;
  status?: readonly string[];
  search?: string;
  limit: number;
}

export interface HelpdeskConnector {
  name: HelpdeskName;
  configured: () => boolean;
  list: (query: TicketQuery) => Promise<HelpdeskTicket[]>;
  get: (id: string) => Promise<{ ticket: HelpdeskTicket; messages: HelpdeskMessage[] }>;
  /** Adds a note only agents can see; returns the new note's id. */
  addNote: (id: string, bodyHtml: string) => Promise<string>;
  download: (attachmentId: string) => Promise<DownloadedFile>;
}
