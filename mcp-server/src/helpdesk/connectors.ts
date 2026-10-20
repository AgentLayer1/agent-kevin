import { pluginName } from '@/shared/naming';
import { pylon } from './pylon';
import { supportcandy } from './supportcandy';
import type { HelpdeskConnector, HelpdeskName } from './types';

const CONNECTORS: Record<HelpdeskName, HelpdeskConnector> = { supportcandy, pylon };

/** The connector a call means: the one named, or the only one configured. */
export const resolveConnector = (
  name: HelpdeskName | undefined,
  connectors: Record<HelpdeskName, HelpdeskConnector> = CONNECTORS
): HelpdeskConnector => {
  if (name) {
    const named = connectors[name];
    if (!named.configured()) {
      throw new Error(`The ${name} helpdesk isn't configured (run /${pluginName()}:configure-skills → Helpdesk pack).`);
    }
    return named;
  }
  const configured = Object.values(connectors).filter((connector) => connector.configured());
  const [only] = configured;
  if (configured.length === 1 && only) {
    return only;
  }
  if (configured.length === 0) {
    throw new Error(`No helpdesk is configured (run /${pluginName()}:configure-skills → Helpdesk pack).`);
  }
  throw new Error(`Several helpdesks are configured (${configured.map((connector) => connector.name).join(', ')}); pass helpdesk to pick one.`);
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
