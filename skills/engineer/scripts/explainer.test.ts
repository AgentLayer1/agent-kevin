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

describe('walkthrough', () => {
  const svg = '<svg viewBox="0 0 10 10"><g data-wt="form"></g><g data-wt="email"></g><g data-wt-token></g></svg>';
  const walkthrough = (script: unknown, picture = svg): string =>
    body(section(`<div class="walkthrough">${picture}<pre class="wt-script">${JSON.stringify(script)}</pre></div>`));
  const steps = (...items: unknown[]) => ({ scenarios: [{ title: 'A signup', steps: items }] });

  test('a script whose ids all exist in its svg passes', () => {
    expect(checkBody(walkthrough(steps({ title: 'Submitted', lit: ['form', 'email'], at: 'email' }))).errors).toEqual([]);
  });

  test('names a lit or token id the svg lacks', () => {
    const errors = checkBody(walkthrough(steps({ title: 'Submitted', lit: ['form', 'audit'], at: 'inbox' }))).errors;
    expect(errors).toEqual([
      'walkthrough 1, scenario 1, step 1: no data-wt="audit" in its svg',
      'walkthrough 1, scenario 1, step 1: no data-wt="inbox" in its svg',
    ]);
  });

  test('refuses a script that is not JSON with scenarios', () => {
    const page = body(section(`<div class="walkthrough">${svg}<pre class="wt-script">{ not json</pre></div>`));
    expect(checkBody(page).errors).toEqual(['walkthrough 1: its wt-script must be JSON with a non-empty "scenarios" list']);
  });

  test('a step that moves the token needs a token element, and every step needs a title', () => {
    const errors = checkBody(walkthrough(steps({ lit: ['form'], at: 'form' }), '<svg><g data-wt="form"></g></svg>')).errors;
    expect(errors).toEqual([
      'walkthrough 1: steps set "at" but its svg has no data-wt-token element',
      'walkthrough 1, scenario 1, step 1: a step needs a "title"',
    ]);
  });
});

describe('mock', () => {
  const mock = (inner: string): string => body(section(`<div class="mock" data-mock-state="draft">${inner}</div>`));

  test('controls that lead to a dialog, a shown state and a pane pass', () => {
    const inner = [
      '<button data-mock-open="publish">Publish…</button><dialog id="publish"><button data-mock-go="published">Publish</button></dialog>',
      '<span data-mock-when="draft">Draft</span><span data-mock-when="published">Published</span>',
      '<button data-mock-tab="admin">Admin</button><div data-mock-pane="admin"></div>',
    ].join('');
    expect(checkBody(mock(inner)).errors).toEqual([]);
  });

  test('names a missing dialog, a state nothing shows, a state nothing sets and a tab without a pane', () => {
    const inner = '<button data-mock-open="publish">Publish…</button><button data-mock-go="archived">Archive</button><span data-mock-when="draft scheduled">x</span><button data-mock-tab="admin">Admin</button>';
    expect(checkBody(mock(inner)).errors).toEqual([
      'mock: data-mock-open="publish" has no <dialog id="publish">',
      'mock: data-mock-go="archived" changes nothing, since no data-mock-when or data-mock-unless names that state',
      'mock: the state "scheduled" is shown for, but no data-mock-go or data-mock-state sets it',
      'mock: data-mock-tab="admin" has no data-mock-pane="admin"',
    ]);
  });
});

describe('reveal', () => {
  test('every card opens its own panel', () => {
    const inner = '<div class="reveal"><button class="reveal-card" data-reveal="setup"></button><div data-reveal-panel="setup"></div></div>';
    expect(checkBody(body(section(inner))).errors).toEqual([]);
  });

  test('names a card with no panel and a panel with no card', () => {
    const inner = '<div class="reveal"><button class="reveal-card" data-reveal="setup"></button><div data-reveal-panel="teardown"></div></div>';
    expect(checkBody(body(section(inner))).errors).toEqual(['reveal: data-reveal="setup" has no data-reveal-panel="setup"', 'reveal: data-reveal-panel="teardown" has no card']);
  });
});

describe('rail', () => {
  test('names an item with no panel and a panel with no item', () => {
    const inner = '<div class="rail"><div class="rail-list"><button class="rail-item" data-rail="step-0"></button></div><div class="rail-panel" data-rail-panel="step-1"></div></div>';
    expect(checkBody(body(section(inner))).errors).toEqual(['rail: data-rail="step-0" has no data-rail-panel="step-0"', 'rail: data-rail-panel="step-1" has no item']);
  });
});
