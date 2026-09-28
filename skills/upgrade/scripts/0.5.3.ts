#!/usr/bin/env bun
/**
 * Upgrade migration for v0.5.3: roadmap pages move their data from a `const ROADMAP = {…}` literal
 * to a JSON block inline in the same page, which the renderer parses, so the focus page (and
 * anything later) can read a roadmap without running it.
 *
 * Each `<HOME>/roadmap.html` and `projects/<slug>/roadmap.html` is rewritten beside itself, then
 * both versions render in Chromium. The new one replaces the old only when the rendered DOM is
 * equal, not one pixel differs, it raises no new page error, and the original hasn't changed
 * meanwhile. Otherwise the page is left untouched and keeps working as it is. Before/after
 * screenshots stay under `<data dir>/updates/roadmap-json-<stamp>/`.
 *
 * Run by `/agent-kevin:upgrade` via `run_upgrade` (outside the Bash sandbox, where Chromium can
 * launch), and by the roadmap skill the same way for a page left behind. Idempotent: a page that
 * already carries the block is skipped. Contract: prints a single-line JSON report as its LAST
 * stdout line. A page left untouched doesn't fail the run, so it never holds the upgrade back;
 * only a run that couldn't judge any page (no Chromium) exits non-zero.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import type { Browser } from 'playwright';
import { FOLDERS } from '../../../mcp-server/src/config';
import {
  LEGACY_LITERAL,
  readRoadmapHtml,
  ROADMAP_PARSE_LINE,
  roadmapDataBlock
} from '../../../mcp-server/src/roadmap/data';
import { getChromium, withBrowserLaunch } from '../../../mcp-server/src/shared/browser-deps';

const VERSION = '0.5.3';
const VIEWPORT = { width: 1440, height: 900 };

interface Literal {
  /** Where `const ROADMAP` starts. */
  statementStart: number;
  /** Just past the literal's closing brace and an optional `;`. */
  statementEnd: number;
  /** The object literal's source text. */
  source: string;
  /** Where the `<script>` tag holding it starts. */
  scriptStart: number;
}

const matchBrace = (text: string, open: number): number => {
  let depth = 0;
  let index = open;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' || char === "'" || char === '`') {
      if (char === '`' && text.slice(index, text.indexOf('`', index + 1)).includes('${')) {
        throw new Error('the literal uses a template string with ${…}, which the migration does not evaluate');
      }
      index += 1;
      while (index < text.length && text[index] !== char) {
        index += text[index] === '\\' ? 2 : 1;
      }
    } else if (char === '/' && next === '/') {
      index = text.indexOf('\n', index);
      if (index === -1) {
        break;
      }
    } else if (char === '/' && next === '*') {
      index = text.indexOf('*/', index + 2) + 1;
      if (index === 0) {
        break;
      }
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  throw new Error('the ROADMAP literal never closes');
};

export const findLiteral = (html: string): Literal | null => {
  const match = LEGACY_LITERAL.exec(html);
  if (!match) {
    return null;
  }
  const open = match.index + match[0].length - 1;
  const close = matchBrace(html, open);
  const scriptStart = html.lastIndexOf('<script', match.index);
  if (scriptStart === -1 || html.slice(scriptStart, match.index).includes('</script')) {
    throw new Error('const ROADMAP is not inside a <script> element');
  }
  const semicolon = /^\s*;/.exec(html.slice(close));
  return {
    statementStart: match.index,
    statementEnd: close + (semicolon ? semicolon[0].length : 0),
    source: html.slice(open, close),
    scriptStart
  };
};

/** Evaluates only the literal, with no globals in reach, and gives up after a second. */
export const evaluateLiteral = (source: string): unknown =>
  runInNewContext(`(${source})`, Object.create(null), { timeout: 1000 });

/** The page with its data moved to an inline JSON block; every other byte is kept. */
export const migrateHtml = (html: string): string => {
  const literal = findLiteral(html);
  if (!literal) {
    throw new Error('no const ROADMAP literal');
  }
  const block = roadmapDataBlock(evaluateLiteral(literal.source));
  const lineStart = html.lastIndexOf('\n', literal.scriptStart) + 1;
  const indent = /^[ \t]*/.exec(html.slice(lineStart, literal.scriptStart))?.[0] ?? '';
  return (
    html.slice(0, literal.scriptStart) +
    `${block}\n${indent}` +
    html.slice(literal.scriptStart, literal.statementStart) +
    ROADMAP_PARSE_LINE +
    html.slice(literal.statementEnd)
  );
};

interface Render {
  dom: string;
  png: Buffer;
  errors: string[];
}

const render = async (browser: Browser, path: string): Promise<Render> => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    await page.goto(pathToFileURL(path).href, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      document.getAnimations().forEach((animation) => {
        if (animation.effect?.getComputedTiming().endTime === Infinity) {
          animation.pause();
          animation.currentTime = 0;
        } else {
          animation.finish();
        }
      });
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
    const dom = await page.evaluate(() => {
      const body = document.body.cloneNode(true);
      if (!(body instanceof HTMLElement)) {
        return '';
      }
      body.querySelectorAll('script').forEach((script) => script.remove());
      return body.outerHTML.replace(/>\s+</g, '><');
    });
    return { dom, png: await page.screenshot({ fullPage: true }), errors };
  } finally {
    await context.close();
  }
};

/** null when the screenshots differ in size. */
const pixelsDiffering = async (browser: Browser, before: Buffer, after: Buffer): Promise<number | null> => {
  if (before.equals(after)) {
    return 0;
  }
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ([first, second]: string[]) => {
        const decode = async (base64: string) => {
          const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext('2d');
          if (!context) {
            throw new Error('no 2d canvas');
          }
          context.drawImage(bitmap, 0, 0);
          return context.getImageData(0, 0, bitmap.width, bitmap.height);
        };
        const [one, two] = await Promise.all([decode(first), decode(second)]);
        if (one.width !== two.width || one.height !== two.height) {
          return null;
        }
        let differing = 0;
        for (let offset = 0; offset < one.data.length; offset += 4) {
          if (
            one.data[offset] !== two.data[offset] ||
            one.data[offset + 1] !== two.data[offset + 1] ||
            one.data[offset + 2] !== two.data[offset + 2] ||
            one.data[offset + 3] !== two.data[offset + 3]
          ) {
            differing += 1;
          }
        }
        return differing;
      },
      [before.toString('base64'), after.toString('base64')]
    );
  } finally {
    await page.close();
  }
};

type Verdict = 'migrated' | 'skipped' | 'left';

interface PageReport {
  path: string;
  verdict: Verdict;
  reason: string;
  pixelsDiffering?: number | null;
  before?: string;
  after?: string;
}

const roadmapPages = (home: string, projects: string): string[] => [
  ...[join(home, 'roadmap.html')].filter(existsSync),
  ...(existsSync(projects)
    ? readdirSync(projects, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(projects, entry.name, 'roadmap.html'))
        .filter(existsSync)
        .sort()
    : [])
];

const evidenceName = (home: string, path: string): string =>
  relative(home, path)
    .replace(/[\\/]/g, '__')
    .replace(/\.html$/, '');

const migratePage = async (browser: Browser, home: string, path: string, evidence: string): Promise<PageReport> => {
  const rel = relative(home, path);
  const html = readFileSync(path, 'utf-8');
  const current = readRoadmapHtml(html);
  if (current?.kind === 'data' || current?.kind === 'invalid') {
    return { path: rel, verdict: 'skipped', reason: 'already carries a roadmap-data block' };
  }
  if (!current) {
    return { path: rel, verdict: 'skipped', reason: 'no const ROADMAP literal, so not a data-driven roadmap page' };
  }
  let migrated: string;
  try {
    migrated = migrateHtml(html);
  } catch (err) {
    return { path: rel, verdict: 'left', reason: err instanceof Error ? err.message : String(err) };
  }
  // Beside the original so relative assets resolve the same; a fixed name, so a run killed midway is cleaned up by the next.
  const temp = join(dirname(path), '.roadmap.migrating.html');
  writeFileSync(temp, migrated);
  try {
    const [before, after] = await Promise.all([render(browser, path), render(browser, temp)]);
    const stem = join(evidence, evidenceName(home, path));
    mkdirSync(evidence, { recursive: true });
    writeFileSync(`${stem}-before.png`, before.png);
    writeFileSync(`${stem}-after.png`, after.png);
    const differing = await pixelsDiffering(browser, before.png, after.png);
    const shots = { pixelsDiffering: differing, before: `${stem}-before.png`, after: `${stem}-after.png` };
    const newErrors = after.errors.filter((error) => !before.errors.includes(error));
    const problem =
      (newErrors.length > 0 && `the migrated page threw: ${newErrors.join('; ')}`) ||
      (before.dom !== after.dom && 'the rendered page differs from the original') ||
      (differing === null && 'the screenshots differ in size') ||
      (differing !== 0 && `${differing} pixels differ`) ||
      (readFileSync(path, 'utf-8') !== html && 'the page was edited while it was being checked; run it again') ||
      '';
    if (problem) {
      return { path: rel, verdict: 'left', reason: problem, ...shots };
    }
    renameSync(temp, path);
    return { path: rel, verdict: 'migrated', reason: 'rendered identically, original replaced', ...shots };
  } finally {
    rmSync(temp, { force: true });
  }
};

export const migrateHome = async (home: string, projects: string, dataDir: string): Promise<PageReport[]> => {
  const pages = roadmapPages(home, projects);
  if (process.platform === 'win32') {
    // TODO(windows): bun can't drive Playwright's pipe transport there, so the render check can't run.
    const reason = 'native Windows cannot run the render check yet; the page keeps working as it is';
    return pages.map((path) => ({ path: relative(home, path), verdict: 'left', reason }));
  }
  if (pages.length === 0) {
    return [];
  }
  const evidence = join(dataDir, 'updates', `roadmap-json-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const chromium = await getChromium();
  const browser = await withBrowserLaunch(() => chromium.launch({ headless: true }));
  try {
    return await pages.reduce<Promise<PageReport[]>>(
      async (done, path) => [...(await done), await migratePage(browser, home, path, evidence)],
      Promise.resolve([])
    );
  } finally {
    await browser.close();
  }
};

if (import.meta.main) {
  const home = resolve(FOLDERS.HOME);
  try {
    const files = await migrateHome(home, FOLDERS.PROJECTS, FOLDERS.DATA);
    const count = (verdict: Verdict) => files.filter((file) => file.verdict === verdict).length;
    console.log(
      JSON.stringify({
        version: VERSION,
        ok: true,
        migrated: count('migrated'),
        skipped: count('skipped'),
        left: count('left'),
        files
      })
    );
  } catch (err) {
    console.log(
      JSON.stringify({ version: VERSION, ok: false, error: err instanceof Error ? err.message : String(err) })
    );
    process.exit(1);
  }
}
