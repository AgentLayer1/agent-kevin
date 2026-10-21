import { describe, expect, test } from 'bun:test';
import { type DOMWindow, JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { isRecord, readJsonBlock } from '@/shared/json-block';
import { BLOCK_ID, TEMPLATE_PATH, renderPage } from '../../skills/engineer/scripts/pr-report';

// The engineer skill's PR report page renders entirely in the browser, so its script is run here against real data.
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf-8');

type Data = Record<string, unknown>;

// jsdom has no matchMedia, which the shared theme block reads; every browser does.
const withMatchMedia = (window: DOMWindow): void => {
  window.matchMedia = (query: string) => ({ matches: false, media: query, addEventListener: () => {} }) as unknown as MediaQueryList;
};

const sample = (): Data => {
  const read = readJsonBlock(TEMPLATE, BLOCK_ID);
  if (read?.kind !== 'data' || !isRecord(read.data)) {
    throw new Error('template has no readable sample');
  }
  return read.data;
};

const open = (html: string) => {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => errors.push(err.message));
  const { document } = new JSDOM(html, { runScripts: 'dangerously', virtualConsole, url: 'file:///report.html', beforeParse: withMatchMedia }).window;
  const count = (selector: string) => document.querySelectorAll(selector).length;
  return { errors, document, count };
};

const replies: Data = {
  kind: 'replies',
  pr: { number: 52, title: 'Count every call', author: 'ada', repo: 'acme/shop', head: '9ab12cd', base: 'main' },
  summary: 'Two threads.',
  threads: [
    {
      id: 'discussion_r1',
      url: 'https://github.com/acme/shop/pull/52#discussion_r1',
      where: 'inline',
      anchor: 'src/limits.ts:14',
      reviewer: 'grace',
      point: 'Rejected calls skip the limit',
      quote: 'Excluding failed',
      status: 'to-post',
      reply: 'Changed.'
    },
    {
      id: 'issuecomment-2',
      url: 'javascript:alert(1)',
      where: 'conversation',
      reviewer: 'bot[bot]',
      bot: true,
      point: 'Summary',
      quote: 'This PR',
      status: 'posted'
    }
  ],
  commits: [{ subject: 'Count rejected calls', body: 'Asked on discussion_r1.' }]
};

describe('pr-report page', () => {
  test('the sample review renders every section, card and copy button without a script error', () => {
    const { errors, count, document } = open(TEMPLATE);
    expect(errors).toEqual([]);
    expect(count('nav.jump a')).toBe(count('section'));
    expect(count('section#findings details.item')).toBe(2);
    expect(count('section#questions details.item')).toBe(1);
    expect(document.getElementById('finding-1')?.tagName).toBe('DETAILS');
    expect(document.querySelector('section#conversation a[href="#finding-1"]')).not.toBeNull();
    // Three comment cards, the same three inside their files, the summary comment and the proposed description.
    expect(count('.paste button')).toBe(8);
    expect(document.querySelector('.riskwhy')?.textContent).toStartWith('Risk L: ');
  });

  test('sections run from understanding to judging to acting, with the badges right under the title', () => {
    const { document } = open(TEMPLATE);
    const ids = [...document.querySelectorAll('section')].map((section) => section.id);
    expect(ids.slice(0, 3)).toEqual(['description', 'how', 'look']);
    expect(ids.indexOf('conversation')).toBeGreaterThan(ids.indexOf('questions'));
    expect(ids.indexOf('files')).toBeGreaterThan(ids.indexOf('conversation'));
    expect(document.querySelector('header.page h1 + .chips')).not.toBeNull();
    expect(document.getElementById('theme-slot')).toBeNull();
  });

  test('a file with nothing behind it is a plain row, and the visuals render', () => {
    const { document, count } = open(TEMPLATE);
    const migration = [...document.querySelectorAll('section#files .row-static')].map((row) => row.textContent ?? '');
    expect(migration.some((text) => text.includes('migrations/0042_reservations.sql'))).toBe(true);
    expect(count('section#how .ba .case')).toBe(2);
    expect(count('section#how .diff .del')).toBe(1);
    expect(count('section#findings .scenario .step.bad')).toBe(1);
    expect(document.querySelector('#finding-1 .raised')?.textContent).toBe('also raised by @coderabbitai[bot]');
    expect(document.querySelector('#finding-1 .paste .label')?.textContent).toBe("Reply on @coderabbitai[bot]'s thread · #418 ↗");
  });

  test('an architecture skeleton renders both panes, with hot lines and dim comments', () => {
    const architecture = {
      today: { title: 'Today', diagram: 'flowchart LR\n  A --> B' },
      target: { title: 'Target', diagram: 'flowchart LR\n  A --> C' },
      concerns: [{ concern: 'Shipping', ok: false, state: 'split', today: 'In checkout', recommended: 'One class', reuses: 'Base' }],
      debt: { adds: ['x'], paysDown: ['y'] },
      path: [{ step: 'One', what: 'Do it' }],
      comparisons: [
        { title: 'Files', today: { title: 'Today files', text: 'a.ts\nb.ts' }, target: { title: 'Target files', text: 'shipping/\n  step.ts  # the step' } },
        { title: 'Code', today: { title: 'Today code', text: '!checkout.branch();  // the finding\nkeep();' }, target: { title: 'Target code', text: `class Provider {}\n// shared code names no provider ${'.'.repeat(60)}` } }
      ]
    };
    const { errors, document } = open(renderPage(TEMPLATE, { ...sample(), architecture }));
    expect(errors).toEqual([]);
    const cardTitled = (title: string) => [...document.querySelectorAll('section#architecture .card')].find((node) => node.querySelector('h3')?.textContent === title);
    expect(cardTitled('Files')?.querySelector('.compare')?.classList.contains('side')).toBe(true);
    const code = cardTitled('Code');
    expect(code?.querySelector('.compare')?.classList.contains('side')).toBe(false);
    expect([...(code?.querySelectorAll('.lbl') ?? [])].map((node) => node.textContent)).toEqual(['Today code', 'Target code']);
    expect(code?.querySelectorAll('.hot')).toHaveLength(1);
    expect(code?.querySelectorAll('.cm')).toHaveLength(2);
  });

  test('findings lead with signal: already-raised, tests and lint, and nits sit lower, collapsed and badged', () => {
    const data = sample();
    const findings = (Array.isArray(data.findings) ? data.findings : []).filter(isRecord);
    const { raisedBy: _raisedBy, ...unraised } = findings[0];
    const lintFinding = { ...unraised, id: 2, severity: 'fix-before-merge', topic: 'lint', title: 'Lint fails once main is merged' };
    const nits = findings.filter((finding) => finding.severity === 'nit').map((finding) => ({ ...finding, id: 3 }));
    const questions = findings.filter((finding) => finding.severity === 'question').map((finding) => ({ ...finding, id: 4 }));
    const { errors, document } = open(renderPage(TEMPLATE, { ...data, findings: [findings[0], lintFinding, ...nits, ...questions] }));
    expect(errors).toEqual([]);
    const section = document.querySelector('section#findings');
    expect([...(section?.querySelectorAll('.group-head') ?? [])].map((head) => head.textContent)).toEqual(['Tests and lint', 'Nits']);
    expect(document.getElementById('finding-1')?.hasAttribute('open')).toBe(true);
    const lint = document.getElementById('finding-2');
    expect(lint?.hasAttribute('open')).toBe(false);
    expect(lint?.querySelector('.pill')?.textContent).toBe('lint');
    // The sample's question repeats a point Grace raised and nobody answered, so it is a reply and sits under its own heading.
    expect(document.querySelector('section#questions .group-head')?.textContent).toBe('Already raised, or about tests and lint');
    expect(document.getElementById('finding-4')?.querySelector('.pill')?.textContent).toBe('replied');
  });

  test('a stack review badges each comment with its PR, links the paste there, and filters by PR', () => {
    const data = sample();
    const findings = (Array.isArray(data.findings) ? data.findings : []).filter(isRecord).map((finding) => (finding.id === 2 ? { ...finding, pr: 417 } : finding));
    const conversation = (Array.isArray(data.conversation) ? data.conversation : [])
      .filter(isRecord)
      .map((thread) => (thread.state === 'wrong' ? { ...thread, url: 'https://github.com/acme/shop/pull/417#discussion_r1000000002' } : thread));
    const { errors, document } = open(renderPage(TEMPLATE, { ...data, findings, conversation }));
    expect(errors).toEqual([]);
    expect(document.getElementById('finding-1')?.querySelector('summary .pill.layer')?.textContent).toBe('PR #418');
    const replyLink = document.getElementById('finding-1')?.querySelector('.paste .label a');
    expect(replyLink?.getAttribute('href')).toBe('https://github.com/acme/shop/pull/418#discussion_r1000000001');
    expect(document.getElementById('finding-1')?.querySelector('.paste .label')?.textContent).toBe("Reply on @coderabbitai[bot]'s thread · #418 ↗");
    const commentLink = document.getElementById('finding-2')?.querySelector('.paste .label a');
    expect(commentLink?.getAttribute('href')).toStartWith('https://github.com/acme/shop/pull/417/files');
    expect(commentLink?.textContent).toBe('#417 ↗');
    // A finding is read at its own layer's head, the diff its comment lands on; the rest of the page reads the edge.
    expect(document.getElementById('finding-2')?.querySelector('summary a')?.getAttribute('href')).toContain('/blob/8d1a4b0/');
    expect(document.getElementById('finding-1')?.querySelector('summary a')?.getAttribute('href')).toContain('/blob/3f9c2e1/');

    const findingFilter = [...document.querySelectorAll('section#findings .filters button')];
    expect(findingFilter.map((button) => button.textContent)).toEqual(['all PRs 2', '#417 1', '#418 1']);
    (findingFilter[1] as HTMLElement).click();
    const shown = (id: string) => (document.getElementById(id) as HTMLElement | null)?.style.display !== 'none';
    expect([shown('finding-1'), shown('finding-2')]).toEqual([false, true]);
    expect([...document.querySelectorAll('section#findings .group-head')].filter((head) => (head as HTMLElement).style.display !== 'none').map((head) => head.textContent)).toEqual(['Nits']);

    const [views, layers] = [...document.querySelectorAll('section#conversation .filters')];
    expect([...layers.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['all PRs', '#417 1', '#418 2']);
    (views.querySelectorAll('button')[1] as HTMLElement).click();
    (layers.querySelectorAll('button')[1] as HTMLElement).click();
    expect([...document.querySelectorAll('section#conversation .pill.layer')].map((pill) => pill.textContent)).toEqual(['PR #417 ↗']);
  });

  test('a single PR shows no PR badges or PR filter', () => {
    const { stack: _stack, ...data } = sample();
    const findings = (Array.isArray(data.findings) ? data.findings : []).filter(isRecord).map(({ pr: _pr, ...finding }) => finding);
    const { errors, count, document } = open(renderPage(TEMPLATE, { ...data, findings }));
    expect(errors).toEqual([]);
    expect(count('.pill.layer')).toBe(0);
    expect(count('section#findings .filters')).toBe(0);
    expect(count('section#conversation .filters')).toBe(1);
    expect(document.getElementById('finding-2')?.querySelector('.paste .label')?.textContent).toBe('Comment to paste');
  });

  test('the proposed description is folded behind a toggle, with its copy button inside', () => {
    const { document } = open(TEMPLATE);
    const fold = document.querySelector('section#description details.more');
    expect(fold?.hasAttribute('open')).toBe(false);
    expect(fold?.querySelector('summary')?.textContent).toStartWith('Proposed description to paste · ');
    expect(fold?.querySelector('.paste button')).not.toBeNull();
  });

  test('a re-review opens on the delta, counted from the prior findings', () => {
    const sinceReview = {
      prior: '10-09, head 1a2b3c4',
      findings: [
        { id: 1, title: 'Edit reads before the lock', status: 'open', now: 'unchanged' },
        { id: 2, title: 'Cancel leaks holds', status: 'fixed', now: 'same transaction now' }
      ]
    };
    const data = sample();
    const findings = (Array.isArray(data.findings) ? data.findings : []).map((finding, index) => (index === 0 && isRecord(finding) ? { ...finding, priorId: 1 } : finding));
    const { errors, document } = open(renderPage(TEMPLATE, { ...data, sinceReview, findings }));
    expect(errors).toEqual([]);
    const order = [...document.querySelectorAll('section')].map((section) => section.id);
    expect(order[order.indexOf('findings') - 1]).toBe('since');
    const stats = [...document.querySelectorAll('section#since .stat')].map((stat) => stat.textContent);
    expect(stats).toEqual(['1fixed', '0changed', '1still open', '2new']);
  });

  test('a clean review with no flows and no findings still renders', () => {
    const { flows: _flows, findings: _findings, conversation: _conversation, ...data } = sample();
    const { errors, document, count } = open(renderPage(TEMPLATE, { ...data, verdict: 'approve' }));
    expect(errors).toEqual([]);
    expect(document.querySelector('section#findings .empty')?.textContent).toBe('No findings.');
    expect(count('.diagram')).toBe(0);
  });

  test('in a stack, a thread without its own pr still shows, under the main PR', () => {
    const threads = Array.isArray(replies.threads) ? replies.threads : [];
    const stacked = { ...replies, threads: [{ ...threads[0], id: 'discussion_r9', pr: 51 }, ...threads] };
    const { errors, count } = open(renderPage(TEMPLATE, stacked));
    expect(errors).toEqual([]);
    expect(count('section#threads details.item')).toBe(3);
  });

  test('a replies page renders its threads, and a non-https url stays text', () => {
    const { errors, document, count } = open(renderPage(TEMPLATE, replies));
    expect(errors).toEqual([]);
    expect(count('section#threads details.item')).toBe(2);
    expect(count('.paste button')).toBe(2);
    expect(document.querySelectorAll('a[href^="javascript:"]')).toHaveLength(0);
    expect(document.querySelector('a[href="https://github.com/acme/shop/pull/52#discussion_r1"]')).not.toBeNull();
  });
});
