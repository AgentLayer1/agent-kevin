/**
 * Pylon payload projections — fat vendor objects down to what a triage or
 * deep-dive read actually needs, with `*_html` bodies converted to text.
 */
import type { PylonAccount, PylonIssue, PylonMacro, PylonMessage } from './types';

const BODY_PREVIEW_CHARS = 400;

let turndownPromise: Promise<(html: string) => string> | null = null;

const buildTurndown = async (): Promise<(html: string) => string> => {
  const TurndownService = (await import('turndown')).default;
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  turndown.remove(['script', 'style']);
  return (html) => turndown.turndown(html).trim();
};

/** Pylon `*_html` body → readable markdown-ish text (links survive). */
export const htmlToText = async (html: string | undefined): Promise<string> => {
  if (!html) return '';
  try {
    turndownPromise ??= buildTurndown();
    return (await turndownPromise)(html);
  } catch {
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
};

/** `Nh` / `Nd` / `Nw` / `Nm` lookback → RFC3339 start time. */
export const sinceToStartTime = (since: string, now: Date = new Date()): string => {
  const match = /^(\d+)([hdwm])$/.exec(since);
  if (!match) throw new Error('Invalid `since` — use Nh / Nd / Nw / Nm (hours/days/weeks/months).');
  const hoursPerUnit = { h: 1, d: 24, w: 24 * 7, m: 24 * 30 } as const;
  const hours = Number(match[1]) * hoursPerUnit[match[2] as keyof typeof hoursPerUnit];
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
};

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export interface TrimmedIssue {
  id: string;
  number?: number;
  title: string;
  body: string;
  state: string;
  type: string;
  source: string;
  link: string;
  created_at?: string;
  updated_at?: string;
  latest_message_activity_at?: string;
  snoozed_until_time?: string;
  tags: string[];
  account_id?: string;
  requester?: { id?: string; email?: string };
  assignee?: { id?: string; email?: string };
  team_id?: string;
  external_issues: Array<{ source: string; external_id: string; link: string }>;
  csat: Array<{ score?: number; comment?: string }>;
}

export async function trimIssue(issue: PylonIssue, mode: 'summary' | 'detail'): Promise<TrimmedIssue> {
  const body = await htmlToText(issue.body_html);
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title ?? '',
    body: mode === 'summary' ? truncate(body, BODY_PREVIEW_CHARS) : body,
    state: issue.state ?? '',
    type: issue.type ?? '',
    source: issue.source ?? '',
    link: issue.link ?? '',
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    latest_message_activity_at: issue.latest_message_activity_at,
    snoozed_until_time: issue.snoozed_until_time,
    tags: issue.tags ?? [],
    account_id: issue.account?.id,
    requester: issue.requester,
    assignee: issue.assignee,
    team_id: issue.team?.id,
    external_issues: (issue.external_issues ?? []).map((external) => ({
      source: external.source ?? '',
      external_id: external.external_id ?? '',
      link: external.link ?? ''
    })),
    csat: issue.csat_responses ?? []
  };
}

export interface TrimmedMessage {
  id: string;
  is_internal_note: boolean;
  author: string;
  author_kind: 'user' | 'contact' | 'unknown';
  timestamp?: string;
  source?: string;
  thread_id?: string;
  text: string;
  file_urls: string[];
}

export async function trimMessage(message: PylonMessage): Promise<TrimmedMessage> {
  const authorKind = message.author?.user ? 'user' : message.author?.contact ? 'contact' : 'unknown';
  return {
    id: message.id,
    is_internal_note: message.is_private ?? false,
    author: message.author?.name ?? message.author?.user?.email ?? message.author?.contact?.email ?? 'unknown',
    author_kind: authorKind,
    timestamp: message.timestamp,
    source: message.source,
    thread_id: message.thread_id,
    text: await htmlToText(message.message_html),
    file_urls: message.file_urls ?? []
  };
}

export interface TrimmedAccount {
  id: string;
  name: string;
  domains: string[];
  type?: string;
  owner?: { id?: string; email?: string };
  tags: string[];
  external_ids: Array<{ label?: string; value?: string }>;
  is_disabled: boolean;
  latest_customer_activity_time?: string;
  created_at?: string;
}

export function trimAccount(account: PylonAccount): TrimmedAccount {
  const domains = [...new Set([account.primary_domain, account.domain, ...(account.domains ?? [])])].filter(
    (domain): domain is string => Boolean(domain)
  );
  return {
    id: account.id,
    name: account.name ?? '',
    domains,
    type: account.type,
    owner: account.owner,
    tags: account.tags ?? [],
    external_ids: account.external_ids ?? [],
    is_disabled: account.is_disabled ?? false,
    latest_customer_activity_time: account.latest_customer_activity_time,
    created_at: account.created_at
  };
}

export interface TrimmedMacro {
  id: string;
  name: string;
  text: string;
  text_type?: string;
  macro_group_id?: string;
  has_actions: boolean;
  action_types: string[];
}

export async function trimMacro(macro: PylonMacro): Promise<TrimmedMacro> {
  return {
    id: macro.id,
    name: macro.name ?? '',
    text: await htmlToText(macro.text_html),
    text_type: macro.text_type,
    macro_group_id: macro.macro_group_id,
    has_actions: macro.has_actions ?? false,
    action_types: (macro.actions ?? []).map((action) => action.type ?? '').filter(Boolean)
  };
}
