/**
 * Browser MCP tools (browser_screenshot/pdf/markdown/record) — in-process
 * browser via the playwright npm package. On native Windows the context comes
 * from a CDP attach instead of an in-process launch (see shared/browser-deps.ts),
 * and browser_record is unavailable there.
 *
 * Chromium is bundled inside the plugin's own `node_modules/playwright/.local-browsers/`
 * (via the `PLAYWRIGHT_BROWSERS_PATH=0` mode used in the package.json postinstall),
 * so the plugin is self-contained — moving or cleaning the plugin dir takes
 * chromium with it. We mirror that env var at runtime so the runtime lookup
 * resolves to the same in-plugin location.
 *
 * Captures land in `<KEVIN_HOME>/reports/captures/<timestamp>-<name>.{png,pdf,webm}`.
 *
 * macOS caveat: browser launch can fail inside sandboxed Claude Code subprocesses
 * (XPC/Crashpad walls). When that happens, the playwright launch promise
 * rejects with a recognizable error; we surface a clean message rather than
 * leaking the stack trace.
 */

import { FOLDERS } from '@/config';
import { acquireContext, withBrowserLaunch, type ChromiumLike, type PageLike } from '@/shared/browser-deps';
import { htmlToMarkdown, renderExtracted } from '@/shared/html-to-markdown';
import { log } from '@/shared/log';
import { defineTool, type ToolDef } from '@/shared/types';
import { marked } from 'marked';
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';

const CAPTURES_DIR = resolve(FOLDERS.REPORTS, 'captures');

const StepSchema = z.object({
  kind: z.enum(['navigate', 'scroll', 'wait']),
  url: z.string().optional(),
  pixels: z.number().int().optional(),
  ms: z.number().int().optional()
});

type Step = z.infer<typeof StepSchema>;

async function getChromium(): Promise<ChromiumLike> {
  // `PLAYWRIGHT_BROWSERS_PATH=0` is set by `.mcp.json` so playwright resolves
  // the browser binary inside the plugin's own `node_modules/playwright/.local-browsers/`
  // (matching the postinstall location). No runtime env mutation needed here.

  let chromium: ChromiumLike;
  try {
    const mod: { chromium: ChromiumLike } = await import('playwright');
    chromium = mod.chromium;
  } catch {
    throw new Error(
      'playwright package is not installed. Run `cd $CLAUDE_PLUGIN_ROOT/mcp-server && bun install` from a normal terminal.'
    );
  }
  const binaryPath = chromium.executablePath();
  if (!binaryPath || !existsSync(binaryPath)) {
    throw new Error(
      "Chromium binary is missing — the plugin's postinstall didn't complete. " +
        'Run `cd $CLAUDE_PLUGIN_ROOT/mcp-server && PLAYWRIGHT_BROWSERS_PATH=0 bunx playwright install chromium` from a normal terminal (outside Claude Code) so the download bypasses the sandbox.'
    );
  }
  return chromium;
}

function captureFilename(action: string, ext: string, name?: string): string {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stem = name ? `${stamp}-${name}` : `${stamp}-${action}`;
  return resolve(CAPTURES_DIR, `${stem}.${ext}`);
}

interface NormalizedInput {
  url: string;
  isFile: boolean;
  /** Absolute filesystem path if input pointed to a local file, else null. */
  filePath: string | null;
}

function normalizeInput(input: string): NormalizedInput {
  if (/^https?:\/\//.test(input)) return { url: input, isFile: false, filePath: null };
  if (input.startsWith('file://')) {
    return { url: input, isFile: true, filePath: fileURLToPath(input) };
  }
  const filePath = isAbsolute(input) ? input : resolve(process.cwd(), input);
  return { url: pathToFileURL(filePath).href, isFile: true, filePath };
}

const MARKDOWN_CSS = `
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif; max-width: 760px; margin: 2.5rem auto; padding: 0 1.5rem; color: #1f2328; }
  h1, h2, h3, h4, h5, h6 { color: #0d1117; margin-top: 1.6em; margin-bottom: .5em; line-height: 1.25; }
  h1 { font-size: 2em; border-bottom: 1px solid #d8dee4; padding-bottom: .3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #eaeef2; padding-bottom: .25em; }
  p { margin: .6em 0; }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: #f6f8fa; padding: 2px 5px; border-radius: 4px; font: 0.88em ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  pre { background: #f6f8fa; padding: 1em; border-radius: 6px; overflow-x: auto; line-height: 1.45; }
  pre code { background: transparent; padding: 0; font-size: 0.85em; }
  pre.mermaid { background: transparent; padding: 0; display: flex; justify-content: center; }
  pre.mermaid svg { max-width: 100%; height: auto; }
  blockquote { border-left: 4px solid #d0d7de; color: #59636e; margin: 1em 0; padding: .2em 1em; }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  th, td { border: 1px solid #d0d7de; padding: .5em .8em; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; }
  hr { border: none; border-top: 1px solid #d8dee4; margin: 2em 0; }
  ul, ol { padding-left: 1.5em; }
  li { margin: .25em 0; }
  img { max-width: 100%; }
`;

// Loaded inside the playwright page via ESM CDN — runs mermaid.run() on any
// <pre class="mermaid"> blocks, then flips window.__renderDone so loadInto()
// knows it's safe to capture.
const MERMAID_BOOTSTRAP = `
<script type="module">
  try {
    const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
    if (document.querySelector('pre.mermaid')) {
      await mermaid.run({ querySelector: 'pre.mermaid' });
    }
  } catch (err) {
    console.error('[mermaid] render failed:', err);
  } finally {
    window.__renderDone = true;
  }
</script>
`;

// Decode HTML entities that marked inserts inside code blocks. Mermaid needs
// the raw source (with `>`, `&`, etc.) — without this, arrows render as `&gt;`.
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const MERMAID_BLOCK_RE = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g;

interface RenderedMarkdown {
  html: string;
  hasMermaid: boolean;
}

async function renderMarkdownFile(filePath: string): Promise<RenderedMarkdown> {
  const md = await readFile(filePath, 'utf-8');
  const raw = await marked.parse(md);
  let hasMermaid = false;
  const body = raw.replace(MERMAID_BLOCK_RE, (_match: string, code: string) => {
    hasMermaid = true;
    return `<pre class="mermaid">${decodeEntities(code)}</pre>`;
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${filePath}</title><style>${MARKDOWN_CSS}</style></head><body>${body}${hasMermaid ? MERMAID_BOOTSTRAP : ''}</body></html>`;
  return { html, hasMermaid };
}

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkdn)$/i;

async function loadInto(page: PageLike, target: NormalizedInput): Promise<void> {
  if (target.isFile && target.filePath && MARKDOWN_EXT.test(target.filePath)) {
    const { html, hasMermaid } = await renderMarkdownFile(target.filePath);
    await page.setContent(html, { waitUntil: 'load' });
    if (hasMermaid) {
      // Wait until the bootstrap script flips the flag. 15s ceiling — past
      // that, capture what we have so a slow CDN doesn't hang the tool.
      try {
        await page.waitForFunction(() => (globalThis as { __renderDone?: boolean }).__renderDone === true, {
          timeout: 15000
        });
      } catch {
        log.info('mermaid render timeout — capturing anyway');
      }
    }
    return;
  }
  await page.goto(target.url, { waitUntil: 'load' });
}

async function runStep(page: PageLike, step: Step): Promise<void> {
  switch (step.kind) {
    case 'navigate':
      if (!step.url) throw new Error('navigate step missing `url`');
      await page.goto(step.url, { waitUntil: 'load' });
      return;
    case 'scroll':
      if (step.pixels === undefined) throw new Error('scroll step missing `pixels`');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.evaluate((px: number) => (globalThis as any).window.scrollBy(0, px), step.pixels);
      return;
    case 'wait':
      if (step.ms === undefined) throw new Error('wait step missing `ms`');
      await page.waitForTimeout(step.ms);
      return;
  }
}

export const tools: ToolDef[] = [
  defineTool({
    name: 'browser_screenshot',
    description:
      'Capture a PNG screenshot of a URL or local HTML/MD file. Requires the Browser pack installed (playwright + chromium).',
    inputSchema: {
      input: z.string().describe('URL, file:// URL, or absolute/relative path'),
      name: z.string().optional().describe('Optional output filename hint'),
      fullPage: z.boolean().optional().describe('Capture full scrolling page')
    },
    handler: async ({ input, name, fullPage }) => {
      const chromium = await getChromium();
      const target = normalizeInput(input);
      const outPath = captureFilename('screenshot', 'png', name);
      const { context, close } = await acquireContext(chromium);
      try {
        const page = await context.newPage();
        await loadInto(page, target);
        await page.screenshot({ path: outPath, fullPage: fullPage ?? false });
        log.info(`screenshot -> ${outPath}`);
      } finally {
        await close();
      }
      return { path: outPath };
    }
  }),
  defineTool({
    name: 'browser_pdf',
    description: 'Render a URL or local file (HTML or Markdown) to PDF. Requires the Browser pack installed.',
    inputSchema: {
      input: z.string(),
      name: z.string().optional()
    },
    handler: async ({ input, name }) => {
      const chromium = await getChromium();
      const target = normalizeInput(input);
      const outPath = captureFilename('pdf', 'pdf', name);
      const { context, close } = await acquireContext(chromium);
      try {
        const page = await context.newPage();
        await loadInto(page, target);
        await page.pdf({ path: outPath, format: 'A4' });
        log.info(`pdf -> ${outPath}`);
      } finally {
        await close();
      }
      return { path: outPath };
    }
  }),
  defineTool({
    name: 'browser_markdown',
    description:
      'Render a URL or local file in chromium so JS-rendered content hydrates, then extract the article body via Mozilla Readability and convert to Markdown. Output saved to reports/captures/<ts>-<name>.md. Use this for SPAs / Next.js / React sites where raw fetch() misses client-rendered sections. Requires the Browser pack installed.',
    inputSchema: {
      input: z.string().describe('URL, file:// URL, or absolute/relative path'),
      name: z.string().optional().describe('Optional output filename hint'),
      waitUntil: z
        .enum(['load', 'networkidle', 'domcontentloaded'])
        .optional()
        .describe('Page load condition (default: networkidle — waits for JS/XHR to settle)')
    },
    handler: async ({ input, name, waitUntil }) => {
      const chromium = await getChromium();
      const target = normalizeInput(input);
      const outPath = captureFilename('markdown', 'md', name);
      const { context, close } = await acquireContext(chromium);
      try {
        const page = await context.newPage();
        if (target.isFile && target.filePath && MARKDOWN_EXT.test(target.filePath)) {
          // Local .md file → no extraction needed, just read as-is. We still
          // load it in the browser so behaviour is symmetric with the other
          // browser_* tools, but skip Readability since the file is
          // already markdown.
          const raw = await readFile(target.filePath, 'utf-8');
          await writeFile(outPath, raw, 'utf-8');
          log.info(`markdown (passthrough) -> ${outPath}`);
          return { path: outPath };
        }
        await page.goto(target.url, { waitUntil: waitUntil ?? 'networkidle' });
        const html = await page.content();
        const extracted = await htmlToMarkdown(html);
        const sourceLine = target.isFile ? '' : `Source: ${target.url}\n\n`;
        const markdown = sourceLine + renderExtracted(extracted);
        await writeFile(outPath, markdown, 'utf-8');
        log.info(`markdown -> ${outPath}`);
      } finally {
        await close();
      }
      return { path: outPath };
    }
  }),
  defineTool({
    name: 'browser_record',
    description:
      'Drive a browser through scripted steps and return a video file. Steps: {kind: navigate|scroll|wait, url|pixels|ms}. Requires the Browser pack installed.',
    inputSchema: {
      input: z.string().describe('Starting URL'),
      steps: z.array(StepSchema),
      name: z.string().optional(),
      viewport: z.object({ width: z.number().int(), height: z.number().int() }).optional()
    },
    handler: async ({ input, steps, name, viewport }) => {
      if (process.platform === 'win32') {
        throw new Error(
          'browser_record is unavailable on native Windows: video needs a Playwright-launched browser, and bun ' +
            'on win32 can only attach over CDP (oven-sh/bun#27977). Use browser_screenshot or browser_markdown instead.'
        );
      }
      const chromium = await getChromium();
      mkdirSync(CAPTURES_DIR, { recursive: true });
      const browser = await withBrowserLaunch(() => chromium.launch({ headless: true }));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const videoDir = resolve(CAPTURES_DIR, `${stamp}-${name ?? 'record'}-tmp`);
      mkdirSync(videoDir, { recursive: true });
      try {
        const context = await browser.newContext({
          recordVideo: { dir: videoDir, size: viewport },
          viewport: viewport ?? null
        });
        const page = await context.newPage();
        await page.goto(input, { waitUntil: 'load' });
        for (const step of steps) {
          await runStep(page, step);
        }
        const video = page.video();
        await context.close();
        if (!video) {
          throw new Error(
            'Recording failed: page.video() returned null (recordVideo may have been disabled by the browser).'
          );
        }
        const outPath = captureFilename('record', 'webm', name);
        await video.saveAs(outPath);
        await video.delete();
        try {
          rmdirSync(videoDir);
        } catch {
          // dir may not be empty if playwright wrote ancillary files; harmless
        }
        log.info(`record -> ${outPath}`);
        return { path: outPath };
      } finally {
        await browser.close();
      }
    }
  })
];
