/**
 * The 0.5.3 roadmap migration against mkdtemp homes (never live data). The rewrite is checked
 * everywhere; the render comparison needs Chromium and skips, with the reason, where a sandbox
 * stops it from launching.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readRoadmapHtml } from '../../../mcp-server/src/roadmap/data';
import { getChromium } from '../../../mcp-server/src/shared/browser-deps';
import { evaluateLiteral, findLiteral, migrateHome, migrateHtml } from './0.5.3';

/** The roadmap template as it shipped before this release, still on a const ROADMAP literal. */
const TEMPLATE = readFileSync(resolve(import.meta.dir, '0.5.3.fixture.html'), 'utf-8');

const page = (
  literal: string,
  renderer = 'document.getElementById("render").textContent = JSON.stringify(ROADMAP);'
): string =>
  `<!doctype html>\n<html><body>\n  <div id="render"></div>\n  <script>\n    /* ROADMAP — the data */\n    const ROADMAP = ${literal};\n    ${renderer}\n  </script>\n</body></html>\n`;

const homes: string[] = [];
const tempHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'roadmap-migration-'));
  homes.push(home);
  return home;
};
afterAll(() => homes.forEach((home) => rmSync(home, { recursive: true, force: true })));

describe('finding the literal', () => {
  test('braces, quotes and semicolons inside strings and comments do not end it early', () => {
    const literal = `{
      // a comment with a } brace
      a: "text with }; and a \\" quote",
      b: 'it\\'s { fine }',
      /* block } comment */
      c: [{ d: 1 }, [2, 3]],
    }`;
    const html = page(literal);
    const found = findLiteral(html);
    expect(found?.source).toBe(literal);
    expect(html.slice(found?.statementEnd)).toStartWith('\n    document.getElementById');
    expect(evaluateLiteral(literal)).toEqual({
      a: 'text with }; and a " quote',
      b: "it's { fine }",
      c: [{ d: 1 }, [2, 3]]
    });
  });

  test('a page without the literal has none', () => {
    expect(findLiteral('<p>no roadmap</p>')).toBeNull();
  });
});

describe('rewriting a page', () => {
  test("the template's data moves to the JSON block and every other byte is kept", () => {
    const migrated = migrateHtml(TEMPLATE);
    const literal = findLiteral(TEMPLATE);
    const read = readRoadmapHtml(migrated);
    expect(read).toMatchObject({ kind: 'data', data: evaluateLiteral(literal?.source ?? '') });
    expect(migrated).toContain('const ROADMAP = JSON.parse(document.getElementById("roadmap-data").textContent);');
    const withoutBlock = migrated.replace(
      /<script type="application\/json" id="roadmap-data">[\s\S]*?<\/script>\n[ \t]*/,
      ''
    );
    const original = TEMPLATE.slice(0, literal?.statementStart) + TEMPLATE.slice(literal?.statementEnd);
    expect(
      withoutBlock.replace('const ROADMAP = JSON.parse(document.getElementById("roadmap-data").textContent);', '')
    ).toBe(original);
    expect(findLiteral(migrated)).toBeNull();
  });

  test('data JSON cannot carry, or a template string it would have to run, is refused', () => {
    expect(() => migrateHtml(page('{ a: { render: () => 1 } }'))).toThrow('ROADMAP.a.render is a function');
    expect(() => migrateHtml(page('{ a: `made ${1 + 1}` }'))).toThrow('template string');
  });

  test('the literal cannot reach anything outside itself', () => {
    expect(() => evaluateLiteral('{ a: process.env.HOME }')).toThrow();
    expect(() => evaluateLiteral('{ a: (() => { while (true) {} })() }')).toThrow();
  });
});

const chromiumBlocked = await getChromium()
  .then((chromium) => chromium.launch({ headless: true }))
  .then((browser) => browser.close().then(() => ''))
  .catch((err: unknown) => (err instanceof Error ? err.message.split('\n')[0] : String(err)));
if (chromiumBlocked) {
  console.log(`0.5.3 render comparison skipped, Chromium can't launch here: ${chromiumBlocked}`);
}

describe.skipIf(Boolean(chromiumBlocked))('migrating a home', () => {
  test('replaces a page only when it renders identically, and a second run skips everything', async () => {
    const home = tempHome();
    const projects = join(home, 'projects');
    const data = join(home, '.kevin');
    const write = (path: string, html: string): string => {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, html);
      return path;
    };
    const root = write(join(home, 'roadmap.html'), TEMPLATE);
    const custom = write(
      join(projects, 'acme', 'roadmap.html'),
      page('{\n  // lanes\n  lane: { title: "Lane", items: [{ text: "<code>ac-001</code>", status: "progress" }] },\n}')
    );
    const unstable = page('{ a: 1 }', 'document.getElementById("render").textContent = String(Math.random());');
    const random = write(join(projects, 'ops', 'roadmap.html'), unstable);
    write(join(projects, 'web', 'roadmap.html'), '<p>a hand-made page</p>');

    const first = await migrateHome(home, projects, data);
    expect(first.map(({ path, verdict }) => [path, verdict])).toEqual([
      ['roadmap.html', 'migrated'],
      ['projects/acme/roadmap.html', 'migrated'],
      ['projects/ops/roadmap.html', 'left'],
      ['projects/web/roadmap.html', 'skipped']
    ]);
    expect(first[0].pixelsDiffering).toBe(0);
    expect(first[2].reason).toContain('the rendered page differs');
    expect(existsSync(join(projects, 'ops', '.roadmap.migrating.html'))).toBe(false);
    expect(readFileSync(random, 'utf-8')).toBe(unstable);
    expect(readRoadmapHtml(readFileSync(root, 'utf-8'))?.kind).toBe('data');
    expect(readRoadmapHtml(readFileSync(custom, 'utf-8'))).toMatchObject({
      kind: 'data',
      data: { lane: { title: 'Lane', items: [{ text: '<code>ac-001</code>', status: 'progress' }] } }
    });
    [first[0].before, first[0].after].forEach((shot) => expect(existsSync(shot ?? '')).toBe(true));

    const second = await migrateHome(home, projects, data);
    expect(second.map(({ verdict }) => verdict)).toEqual(['skipped', 'skipped', 'left', 'skipped']);
  }, 120_000);
});
