/**
 * HTML sanitizer for untrusted markup the dashboard renders inline (currently
 * the where-am-i radar digest; reusable for any future inline-HTML surface).
 *
 * DOMPurify needs a real DOM to walk, and linkedom is too thin for it (no
 * `document.implementation.createHTMLDocument`, so DOMPurify silently no-ops).
 * jsdom provides a complete enough DOM. Both deps are heavy, so they load
 * lazily on first call and the configured DOMPurify instance is memoised for
 * the life of the process.
 */

import type { Config, WindowLike } from 'dompurify';

type Sanitizer = (dirty: string, config?: Config) => string;

let sanitizerPromise: Promise<Sanitizer> | null = null;

const buildSanitizer = async (): Promise<Sanitizer> => {
  const [{ default: createDOMPurify }, { JSDOM }] = await Promise.all([import('dompurify'), import('jsdom')]);
  const purify = createDOMPurify(new JSDOM('').window as unknown as WindowLike);
  return (dirty, config) => purify.sanitize(dirty, config);
};

/** DOMPurify's default allowed-URI matcher, with extra schemes (e.g. the
 *  dashboard's `obsidian://`/`markedit://` opener) spliced into the alternation.
 *  Defaults block such schemes, so injected file-opener links get their href
 *  stripped without this. */
const uriRegexpAllowing = (schemes: readonly string[]): RegExp => {
  const extra = schemes.map((scheme) => scheme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(
    `^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp${extra ? `|${extra}` : ''}):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`,
    'i'
  );
};

/**
 * Strip scripts, event-handler attributes, and dangerous URLs from untrusted
 * HTML. Safe presentational markup (headings, links, code, lists, emphasis) is
 * preserved. Async because the DOM backing loads lazily on first use.
 *
 * `allowSchemes` whitelists otherwise-blocked URL schemes (e.g. `obsidian`) so
 * markdown-opener links survive; omit it for byte-identical default behaviour.
 */
export const sanitizeHtml = async (dirty: string, opts?: { allowSchemes?: string[] }): Promise<string> => {
  sanitizerPromise ??= buildSanitizer();
  const config = opts?.allowSchemes?.length ? { ALLOWED_URI_REGEXP: uriRegexpAllowing(opts.allowSchemes) } : undefined;
  return (await sanitizerPromise)(dirty, config);
};
