/**
 * Helpdesk tools — one surface over every configured helpdesk (SupportCandy,
 * Pylon). Reads (tickets, conversations, attachments, accounts, lookups) and one write: a note only agents see. Nothing here
 * replies to a customer, changes a ticket's fields or closes it; a person
 * sends every reply. Ticket text crosses the trust boundary, so it comes back
 * wrapped as untrusted.
 */
import { assertFilters, connectors, labelOf, noteHtml, resolveConnector } from '@/helpdesk/connectors';
import { saveToTemp } from '@/helpdesk/download';
import { HELPDESKS, LOOKUP_KINDS } from '@/helpdesk/types';
import { sinceToStartTime } from '@/shared/date';
import { defineTool, type ToolDef } from '@/shared/types';
import { untrusted } from '@/shared/untrusted';
import { z } from 'zod';

const HELPDESK = z.enum(HELPDESKS).optional().describe('Which helpdesk; only needed when more than one is configured.');
const CONNECTION = z
  .string()
  .min(1)
  .optional()
  .describe("A named connection from helpdesk_connections (the queue profile's connection); omit for the default.");

export const tools: ToolDef[] = [
  defineTool({
    name: 'helpdesk_connections',
    description:
      'List the configured helpdesk connections: each helpdesk, its connection name (absent for the default) and its site where that is not a secret. Read-only; never returns a credential. Pass helpdesk and connection to the other helpdesk tools to pick one.',
    inputSchema: {},
    handler: async () => ({
      connections: connectors().map((connector) => ({
        helpdesk: connector.name,
        ...(connector.connection && { connection: connector.connection }),
        ...(connector.site && { site: connector.site })
      }))
    })
  }),
  defineTool({
    name: 'helpdesk_tickets',
    description:
      "List helpdesk tickets updated within a lookback window, newest first: id, number, subject, status, category or tags, requester and assignee (name, email where the helpdesk gives them), account id, dates and an agent link. Read-only. Filter by status names and free-text search; Pylon also filters by tags, assignee and account. since 'any' drops the window, for tickets of any age. Works over whichever helpdesk is configured (SupportCandy, Pylon). Read a ticket's conversation with helpdesk_ticket.",
    inputSchema: {
      helpdesk: HELPDESK,
      connection: CONNECTION,
      since: z
        .string()
        .regex(/^(\d+[hdwm]|any)$/, "Use Nh / Nd / Nw / Nm (hours/days/weeks/months) or 'any'")
        .optional()
        .describe("Updated within this window: Nh / Nd / Nw / Nm, or 'any' for no window. Default 7d."),
      status: z.array(z.string().min(1)).optional().describe('Status names to keep, as the helpdesk names them (OR-ed).'),
      search: z.string().optional().describe('Free-text search.'),
      tags: z.array(z.string().min(1)).optional().describe('Tags the ticket must carry (AND-ed).'),
      assignee: z.string().min(1).optional().describe('Teammate id, from helpdesk_lookups teammates.'),
      account: z.string().min(1).optional().describe('Account id, from helpdesk_accounts.'),
      limit: z.number().int().positive().max(1000).optional().describe('Max tickets. Default 50.')
    },
    handler: async (args) => {
      const connector = resolveConnector(args);
      assertFilters(connector, args);
      const since = args.since ?? '7d';
      const tickets = await connector.list({
        ...(since !== 'any' && { updatedSince: sinceToStartTime(since) }),
        status: args.status,
        search: args.search,
        tags: args.tags,
        assignee: args.assignee,
        account: args.account,
        limit: args.limit ?? 50
      });
      return untrusted(`${labelOf(connector)}:tickets`, JSON.stringify({ helpdesk: labelOf(connector), count: tickets.length, tickets }, null, 2));
    }
  }),
  defineTool({
    name: 'helpdesk_ticket',
    description:
      "Fetch one helpdesk ticket with its whole conversation, oldest first: the ticket's opening body when the helpdesk keeps it apart, linked engineering issues and CSAT (Pylon). Each message is tagged customer, agent, note (agents only) or event (a status change and the like), names its author, and lists its attachments by id and name; fetch one with helpdesk_attachment. Read-only.",
    inputSchema: {
      helpdesk: HELPDESK,
      connection: CONNECTION,
      id: z.string().min(1).describe('Ticket id as the helpdesk shows it.')
    },
    handler: async ({ helpdesk, connection, id }) => {
      const connector = resolveConnector({ helpdesk, connection });
      return untrusted(`${labelOf(connector)}:ticket`, JSON.stringify(await connector.get(id), null, 2));
    }
  }),
  defineTool({
    name: 'helpdesk_attachment',
    description:
      "Download one ticket attachment (a log, a screenshot) by the id helpdesk_ticket listed, into a fresh temp folder outside the home, and return its path. Read-only. Read the file from there or pass the path to github_issue_create's attachments; it is a user's data, so never copy it into the brain.",
    inputSchema: {
      helpdesk: HELPDESK,
      connection: CONNECTION,
      id: z.string().min(1).describe('Attachment id from helpdesk_ticket.')
    },
    handler: async ({ helpdesk, connection, id }) => {
      const connector = resolveConnector({ helpdesk, connection });
      const file = await connector.download(id);
      return { helpdesk: labelOf(connector), name: file.name, contentType: file.contentType, bytes: file.bytes.byteLength, path: saveToTemp(file) };
    }
  }),
  defineTool({
    name: 'helpdesk_note',
    description:
      'Add a private note to a helpdesk ticket: visible to agents, never to the customer. The one write in the Helpdesk pack, used to leave a draft reply for a person to edit and send. Plain text; blank lines start paragraphs. Never use it to reach the customer.',
    inputSchema: {
      helpdesk: HELPDESK,
      connection: CONNECTION,
      id: z.string().min(1).describe('Ticket id.'),
      text: z.string().min(1).describe('The note, as plain text.')
    },
    handler: async ({ helpdesk, connection, id, text }) => {
      const connector = resolveConnector({ helpdesk, connection });
      const noteId = await connector.addNote(id, noteHtml(text));
      return { ok: true, helpdesk: labelOf(connector), ticket: id, note: noteId };
    }
  }),
  defineTool({
    name: 'helpdesk_accounts',
    description:
      "List the helpdesk's accounts (customer companies): id, name, domains, tags and owner. Read-only. search matches name or domain. Pass an id to helpdesk_tickets account to see that account's tickets. Pylon only.",
    inputSchema: {
      helpdesk: HELPDESK,
      connection: CONNECTION,
      search: z.string().min(1).optional().describe('Case-insensitive match on account name or domain.'),
      limit: z.number().int().positive().max(1000).optional().describe('Max accounts. Default 100.')
    },
    handler: async ({ helpdesk, connection, search, limit }) => {
      const connector = resolveConnector({ helpdesk, connection });
      if (!connector.accounts) {
        throw new Error(`${connector.name} has no accounts.`);
      }
      const matched = await connector.accounts(search);
      const accounts = matched.slice(0, limit ?? 100);
      return untrusted(`${labelOf(connector)}:accounts`, JSON.stringify({ helpdesk: labelOf(connector), count: accounts.length, total_matched: matched.length, accounts }, null, 2));
    }
  }),
  defineTool({
    name: 'helpdesk_lookups',
    description:
      "List one kind of helpdesk reference data as id + name: statuses and categories (SupportCandy), teammates (both; with email on Pylon), tags and macros with their text (Pylon). Read-only. Use the names in helpdesk_tickets filters and macros for a draft's house tone.",
    inputSchema: {
      helpdesk: HELPDESK,
      connection: CONNECTION,
      kind: z.enum(LOOKUP_KINDS).describe('Which list.')
    },
    handler: async ({ helpdesk, connection, kind }) => {
      const connector = resolveConnector({ helpdesk, connection });
      const lookup = connector.lookups[kind];
      if (!lookup) {
        const kinds = LOOKUP_KINDS.filter((name) => connector.lookups[name]);
        throw new Error(`${connector.name} has no ${kind}; it has ${kinds.join(', ')}.`);
      }
      const items = await lookup();
      return untrusted(`${labelOf(connector)}:${kind}`, JSON.stringify({ helpdesk: labelOf(connector), kind, count: items.length, items }, null, 2));
    }
  })
];
