import { PYLON_TOKEN_KEY } from '@/pylon/config';
import { namedKeys } from '@/shared/env';
import { pluginName } from '@/shared/naming';
import { pylon } from './pylon';
import { SUPPORTCANDY_URL_KEY, supportcandy } from './supportcandy';
import { HELPDESKS, TICKET_FILTERS, type HelpdeskConnector, type HelpdeskName, type TicketQuery } from './types';

const KINDS: Record<HelpdeskName, { make: (connection?: string) => HelpdeskConnector; prefix: string }> = {
  supportcandy: { make: supportcandy, prefix: SUPPORTCANDY_URL_KEY },
  pylon: { make: pylon, prefix: PYLON_TOKEN_KEY }
};

const SETUP = `run /${pluginName()}:configure-skills → Helpdesk pack`;

/** Every configured connection: each helpdesk's default, then one per `<KEY>_<NAME>` it finds. */
export const connectors = (): HelpdeskConnector[] =>
  HELPDESKS.flatMap((kind) => {
    const { make, prefix } = KINDS[kind];
    return [make(), ...namedKeys(prefix).map(({ name }) => make(name))].filter((connector) => connector.configured());
  });

const normal = (name: string): string => name.toUpperCase().replace(/[^A-Z0-9]/g, '_');

export const labelOf = (connector: HelpdeskConnector): string => (connector.connection ? `${connector.name}:${connector.connection}` : connector.name);

/**
 * The connector a call means. A named connection must have keys of its own; no name means the
 * default, or the only connection there is.
 */
export const resolveConnector = (
  { helpdesk, connection }: { helpdesk?: HelpdeskName; connection?: string },
  available: readonly HelpdeskConnector[] = connectors()
): HelpdeskConnector => {
  const ofKind = available.filter((connector) => !helpdesk || connector.name === helpdesk);
  if (connection) {
    const named = ofKind.filter((connector) => connector.connection && normal(connector.connection) === normal(connection));
    const [only] = named;
    if (named.length === 1 && only) {
      return only;
    }
    if (named.length > 1) {
      throw new Error(`Both helpdesks have a "${connection}" connection; pass helpdesk to pick one.`);
    }
    const keys = (helpdesk ? [helpdesk] : HELPDESKS).flatMap((kind) => KINDS[kind].make(connection).keys);
    throw new Error(`The "${connection}" connection isn't fully set up: it needs ${keys.join(', ')} (${SETUP}).`);
  }
  const defaults = ofKind.filter((connector) => !connector.connection);
  const pick = defaults.length > 0 ? defaults : ofKind;
  const [only] = pick;
  if (pick.length === 1 && only) {
    return only;
  }
  if (ofKind.length === 0) {
    throw new Error(`No ${helpdesk ?? 'helpdesk'} is configured (${SETUP}).`);
  }
  throw new Error(`Several helpdesk connections are configured (${ofKind.map(labelOf).join(', ')}); pass helpdesk and connection to pick one.`);
};

/** A filter the helpdesk can't apply is refused, never silently dropped. */
export const assertFilters = (connector: HelpdeskConnector, query: Pick<TicketQuery, (typeof TICKET_FILTERS)[number]>): void => {
  const missing = TICKET_FILTERS.filter((filter) => (query[filter]?.length ?? 0) > 0 && !connector.filters.has(filter));
  if (missing.length > 0) {
    throw new Error(`${connector.name} can't filter tickets by ${missing.join(' or ')}.`);
  }
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text with blank-line paragraphs → the HTML both helpdesks store notes as. */
export const noteHtml = (text: string): string =>
  text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
