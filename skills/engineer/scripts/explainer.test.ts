import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bodyOf, checkBody, renderPage, TEMPLATE_PATH } from './explainer';

const SCRIPT = join(import.meta.dir, 'explainer.ts');
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf-8');
const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const run = (...args: string[]) => {
  const proc = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, NODE_PATH: join(import.meta.dir, '..', '..', '..', 'mcp-server', 'node_modules') } });
  return { status: proc.status, out: proc.stdout.toString(), err: proc.stderr.toString() };
};

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'explainer-'));
  dirs.push(dir);
  return dir;
};

const body = (sections: string, title = 'How &amp; why <em>sync</em> works'): string => `<h1>${title}</h1>\n${sections}`;
const section = (inner: string): string => `<section>\n<h2>Flow</h2>\n${inner}\n</section>`;

describe('checkBody', () => {
  test('the template sample is a valid body', () => {
    const sample = bodyOf(TEMPLATE);
    expect(sample).not.toBeNull();
    expect(checkBody(sample ?? '').errors).toEqual([]);
  });

  test('takes the title as plain text from the one <h1>', () => {
    expect(checkBody(body(section('<p>x</p>'))).title).toBe('How &amp; why sync works');
  });

  test('rejects script, style and event handlers, which the shell owns', () => {
    const errors = checkBody(body(section('<script>x()</script><style>p{}</style><img src="a" onerror="x()">'))).errors;
    expect(errors.filter((error) => error.includes('the shell owns'))).toHaveLength(2);
  });

  test('rejects the spellings a browser still runs as script', () => {
    const bypasses = [
      '<img/onerror=x() src=a>',
      '<a href="&#106;avascript:x()">go</a>',
      '<a href="&#x6A;avascript:x()">go</a>',
      '<a href="java\tscript:x()">go</a>',
      '<a href="javascript&colon;x()">go</a>',
      '<form action="javascript:x()"><button>go</button></form>',
      '<object data="x.swf"></object>',
      '<meta http-equiv="refresh" content="0;url=https://example.com">',
      '<base href="https://example.com/">'
    ];
    bypasses.forEach((html) => expect(checkBody(body(section(html))).errors.join()).toContain('the shell owns'));
  });

  test('allows prose that merely says "on"', () => {
    expect(checkBody(body(section('<p>Turn it on = done, once = enough; never write javascript: links.</p>'))).errors).toEqual([]);
    expect(checkBody(body(section('<a href="javascript:x()">go</a>'))).errors[0]).toContain('javascript:');
  });

  test('a comment before the <h2> and a single-quoted diagram class still read', () => {
    const result = checkBody(body("<section><!-- intro --><h2>A</h2><pre class='diagram'>flowchart LR\n  A --> B</pre></section>"));
    expect(result.errors).toEqual([]);
    expect(result.diagrams).toHaveLength(1);
  });

  test('needs one <h1> and sections that open with an <h2>', () => {
    expect(checkBody('<section><h2>A</h2></section>').errors).toContain('the body needs exactly one <h1> (the page title), found 0');
    expect(checkBody(body('<section><p>no heading</p></section>')).errors).toContain("section 1 doesn't open with an <h2>");
    expect(checkBody('<h1>T</h1><p>loose</p>').errors[0]).toContain('no <section>');
  });

  test('a diagram must escape its markup, and hands back the decoded source', () => {
    expect(checkBody(body(section('<pre class="diagram">flowchart LR\n  A["a<br/>b"] --> B</pre>'))).errors[0]).toContain('&lt;br/&gt;');
    const ok = checkBody(body(section('<pre class="diagram">flowchart LR\n  A["a&lt;br/&gt;b"] --&gt; B</pre>')));
    expect(ok.errors).toEqual([]);
    expect(ok.diagrams).toEqual([{ label: 'diagram 1', source: 'flowchart LR\n  A["a<br/>b"] --> B' }]);
  });

  test('a code block must escape its markup, though a <code> wrapper and a bare < are fine', () => {
    expect(checkBody(body(section('<pre>const done: Promise<void> = run();</pre>'))).errors[0]).toContain('code block 1 holds raw markup');
    expect(checkBody(body(section('<pre data-lang="typescript"><code>const done: Promise&lt;void&gt; = run();\nif (a < b) {}</code></pre>'))).errors).toEqual([]);
  });
});

describe('renderPage', () => {
  test('swaps the body and title, keeping the shell', () => {
    const page = renderPage(TEMPLATE, body(section('<p>new</p>')), 'A &mdash; title');
    expect(page).toContain('<title>A &mdash; title</title>');
    expect(bodyOf(page)).toContain('<p>new</p>');
    expect(page).not.toContain('How stock reservations work</h1>');
    expect(page).toContain('<!-- theme:start -->');
    expect(page).toContain('class="toc-btn"');
  });
});

describe('cli', () => {
  test('write puts the page beside the card, and check passes it', () => {
    const dir = scratch();
    const card = join(dir, '2026-01-02-0304-acme-explainer.md');
    const fragment = join(dir, 'body.html');
    writeFileSync(card, '# card\n');
    writeFileSync(fragment, body(section('<pre class="diagram">flowchart LR\n  A --&gt; B</pre>')));
    expect(run('check', fragment).status).toBe(0);
    const written = run('write', fragment, card);
    expect(written.err).toBe('');
    const page = join(dir, '2026-01-02-0304-acme-explainer.html');
    expect(written.out.trim()).toBe(page);
    expect(run('check', page).status).toBe(0);
  });

  test('a diagram that does not parse writes nothing', () => {
    const dir = scratch();
    const card = join(dir, 'c.md');
    const fragment = join(dir, 'body.html');
    writeFileSync(card, '# card\n');
    writeFileSync(fragment, body(section('<pre class="diagram">flowchart LR\n  A --&gt;</pre>')));
    const result = run('write', fragment, card);
    expect(result.status).toBe(1);
    expect(result.err).toContain("diagram 1: diagram doesn't parse");
    expect(existsSync(join(dir, 'c.html'))).toBe(false);
  });

  test('refuses a missing card', () => {
    const dir = scratch();
    const fragment = join(dir, 'body.html');
    writeFileSync(fragment, body(section('<p>x</p>')));
    expect(run('write', fragment, join(dir, 'missing.md')).err).toContain('no card at');
  });
});
