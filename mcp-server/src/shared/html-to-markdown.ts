/**
 * HTML → Markdown extraction pipeline.
 *
 * Shared by URL capture (raw `fetch()` body) and browser_markdown
 * (chromium-rendered DOM). Pipeline: linkedom parses HTML → Mozilla
 * Readability finds the article body (drops nav/footer/sidebar/modals
 * heuristically) → Turndown converts the extracted HTML fragment to Markdown.
 *
 * Always returns a result. On Readability failure (rare — paywalled stubs,
 * weird markup), falls back to a regex strip of structural noise so callers
 * never have to handle null.
 */

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

export interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  markdown: string;
}

function extractTitleTag(html: string): string | null {
  const m = TITLE_RE.exec(html);
  if (!m) return null;
  return m[1].replace(/\s+/g, ' ').trim() || null;
}

/** Last-resort fallback when Readability + Turndown can't process the page —
 *  e.g. malformed markup, paywalled stubs with no article body. Strips noisy
 *  blocks but leaves remaining tags for downstream readers to work through. */
function sanitizeHtmlFallback(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function htmlToMarkdown(html: string): Promise<ExtractedArticle> {
  try {
    const { parseHTML } = await import('linkedom');
    const { Readability } = await import('@mozilla/readability');
    const TurndownService = (await import('turndown')).default;

    const { document } = parseHTML(html);
    // Readability expects a Document; linkedom's matches the shape closely
    // enough for runtime, but the type union upstream is browser-DOM.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new Readability(document as any);
    const article = reader.parse();
    if (article && article.content) {
      const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '*'
      });
      td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button']);
      const markdown = td.turndown(article.content).trim();
      if (markdown) {
        return {
          title: article.title?.trim() || extractTitleTag(html),
          byline: article.byline?.trim() || null,
          markdown
        };
      }
    }
  } catch {
    // fall through to regex fallback
  }
  return {
    title: extractTitleTag(html),
    byline: null,
    markdown: sanitizeHtmlFallback(html)
  };
}

/** Convenience: render an ExtractedArticle into a single Markdown string with
 *  `# Title`, *byline*, and the body — the format both capture and the
 *  browser_markdown tool write to disk. */
export function renderExtracted(extracted: ExtractedArticle): string {
  const heading = extracted.title ? `# ${extracted.title}\n\n` : '';
  const byline = extracted.byline ? `*${extracted.byline}*\n\n` : '';
  return `${heading}${byline}${extracted.markdown}`;
}
