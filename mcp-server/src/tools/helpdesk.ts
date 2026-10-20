/**
 * Helpdesk tools — one surface over every configured helpdesk (SupportCandy,
 * Pylon). Reads (tickets, conversations, attachments) and one write: a note only agents see. Nothing here
 * replies to a customer, changes a ticket's fields or closes it; a person
 * sends every reply. Ticket text crosses the trust boundary, so it comes back
 * wrapped as untrusted.
 */
import { noteHtml, resolveConnector } from '@/helpdesk/connectors';
import { saveToTemp } from '@/helpdesk/download';
import { HELPDESKS } from '@/helpdesk/types';
import { sinceToStartTime } from '@/pylon/format';
import { defineTool, type ToolDef } from '@/shared/types';
import { untrusted } from '@/shared/untrusted';
import { z } from 'zod';

const HELPDESK = z.enum(HELPDESKS).optional().describe('Which helpdesk; only needed when more than one is configured.');

export const tools: ToolDef[] = [
  defineTool({
    name: 'helpdesk_tickets',
    description:
      'List helpdesk tickets updated within a lookback window, newest first, with a preview of each opening message. Read-only. Filter by status names and free-text search. Works over whichever helpdesk is configured (SupportCandy, Pylon). Requester names and emails are never returned. Use helpdesk_ticket for the whole conversation.',
    inputSchema: {
      helpdesk: HELPDESK,
      since: z
        .string()
        .regex(/^\d+[hdwm]$/, 'Use Nh / Nd / Nw / Nm (hours/days/weeks/months)')
        .optional()
        .describe('Updated within this window: Nh / Nd / Nw / Nm. Default 7d.'),
      status: z.array(z.string().min(1)).optional().describe('Status names to keep, as the helpdesk names them (OR-ed).'),
      search: z.string().optional().describe('Free-text search.'),
      limit: z.number().int().positive().max(200).optional().describe('Max tickets. Default 50.')
    },
    handler: async (args) => {
      const connector = resolveConnector(args.helpdesk);
      const tickets = await connector.list({
        updatedSince: sinceToStartTime(args.since ?? '7d'),
        status: args.status,
        search: args.search,
        limit: args.limit ?? 50
      });
      return untrusted(`${connector.name}:tickets`, JSON.stringify({ helpdesk: connector.name, count: tickets.length, tickets }, null, 2));
    }
  }),
  defineTool({
    name: 'helpdesk_ticket',
    description:
      "Fetch one helpdesk ticket with its whole conversation, oldest first. Each message is tagged customer, agent, note (agents only) or event (a status change and the like) and lists its attachments by id and name; fetch one with helpdesk_attachment. Read-only. Requester names and emails are never returned.",
    inputSchema: {
      helpdesk: HELPDESK,
      id: z.string().min(1).describe('Ticket id as the helpdesk shows it.')
    },
    handler: async ({ helpdesk, id }) => {
      const connector = resolveConnector(helpdesk);
      return untrusted(`${connector.name}:ticket`, JSON.stringify(await connector.get(id), null, 2));
    }
  }),
  defineTool({
    name: 'helpdesk_attachment',
    description:
      "Download one ticket attachment (a log, a screenshot) by the id helpdesk_ticket listed, into a fresh temp folder outside the home, and return its path. Read-only. Read the file from there or pass the path to github_issue_create's attachments; it is a user's data, so never copy it into the brain.",
    inputSchema: {
      helpdesk: HELPDESK,
      id: z.string().min(1).describe('Attachment id from helpdesk_ticket.')
    },
    handler: async ({ helpdesk, id }) => {
      const connector = resolveConnector(helpdesk);
      const file = await connector.download(id);
      return { helpdesk: connector.name, name: file.name, contentType: file.contentType, bytes: file.bytes.byteLength, path: saveToTemp(file) };
    }
  }),
  defineTool({
    name: 'helpdesk_note',
    description:
      'Add a private note to a helpdesk ticket: visible to agents, never to the customer. The one write in the Helpdesk pack, used to leave a draft reply for a person to edit and send. Plain text; blank lines start paragraphs. Never use it to reach the customer.',
    inputSchema: {
      helpdesk: HELPDESK,
      id: z.string().min(1).describe('Ticket id.'),
      text: z.string().min(1).describe('The note, as plain text.')
    },
    handler: async ({ helpdesk, id, text }) => {
      const connector = resolveConnector(helpdesk);
      const noteId = await connector.addNote(id, noteHtml(text));
      return { ok: true, helpdesk: connector.name, ticket: id, note: noteId };
    }
  })
];
