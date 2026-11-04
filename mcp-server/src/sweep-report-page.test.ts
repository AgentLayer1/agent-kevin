import { describe, expect, test } from 'bun:test';
import { type DOMWindow, JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { isRecord, readJsonBlock } from '@/shared/json-block';
import { BLOCK_ID, TEMPLATE_PATH, renderPage } from '../../skills/engineer/scripts/sweep-report';

// The engineer skill's sweep page renders entirely in the browser, so its script is run here against real data.
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf-8');

type Data = Record<string, unknown>;

// jsdom has no matchMedia or scrollIntoView, which the page uses; every browser does.
const withMatchMedia = (window: DOMWindow): void => {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener: () => {} }) as unknown as MediaQueryList;
  window.Element.prototype.scrollIntoView = () => {};
};

const sample = (): Data => {
  const read = readJsonBlock(TEMPLATE, BLOCK_ID);
  if (read?.kind !== 'data' || !isRecord(read.data)) {
    throw new Error('template has no readable sample');
  }
  return read.data;
};

// A reload is a fresh window seeded with the previous one's storage before the page script runs.
const open = (html: string, previous?: JSDOM) => {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => errors.push(err.message));
  const saved = previous ? Object.fromEntries(Object.entries(previous.window.localStorage)) : {};
  const page = new JSDOM(html, {
    runScripts: 'dangerously',
    virtualConsole,
    url: 'http://localhost/sweep.html',
    beforeParse: (window) => {
      withMatchMedia(window);
      Object.entries(saved).forEach(([key, value]) => window.localStorage.setItem(key, String(value)));
    }
  });
  const { document } = page.window;
  const visible = (selector: string) =>
    [...document.querySelectorAll(selector)].filter((node) => !node.classList.contains('hidden'));
  const button = (label: string) =>
    [...document.querySelectorAll('.toolbar button')].find((node) => node.textContent?.startsWith(label));
  const click = (label: string) => button(label)?.dispatchEvent(new page.window.MouseEvent('click'));
  return { errors, document, page, visible, button, click };
};

describe('sweep page', () => {
  test('renders every section from the sample with no script errors', () => {
    const { errors, document } = open(renderPage(TEMPLATE, sample()));
    expect(errors).toEqual([]);
    expect([...document.querySelectorAll('details.sec')].map((node) => node.id)).toEqual([
      'first-moves',
      'descriptions',
      'promises',
      'needs-code',
      'conflicts',
      'by-issue',
      'mine',
      'reviews',
      'quiet'
    ]);
    expect(document.querySelectorAll('.owed')).toHaveLength(3);
  });

  test('issue groups hold their PRs, and folds start closed unless something new is inside', () => {
    const { document } = open(renderPage(TEMPLATE, sample()));
    const issue = document.getElementById('issue-40') as HTMLDetailsElement;
    expect(issue.querySelector('#pr-42')).not.toBeNull();
    expect(issue.open).toBe(true);
    expect((document.getElementById('conflicts') as HTMLDetailsElement).open).toBe(false);
    expect((document.getElementById('pr-44') as HTMLDetailsElement).open).toBe(false);
  });

  test('a pending review is called out on its PR', () => {
    const { document } = open(renderPage(TEMPLATE, sample()));
    expect(document.querySelector('#reviews #pr-51 summary')?.textContent).toContain('pending: submit it');
  });

  test('ticking an item marks it handled, updates the counts, and survives a reload', () => {
    const first = open(renderPage(TEMPLATE, sample()));
    const box = first.document.querySelector('.owed[data-id="discussion_r7001"] input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new first.page.window.Event('change'));
    expect(box.closest('.owed')?.classList.contains('handled')).toBe(true);
    expect(first.document.querySelector('.progress span')?.textContent).toBe('1 of 5 handled');
    expect(first.document.querySelector('#pr-42 > summary [data-count]')?.textContent).toBe('1 of 2 left');
    const second = open(renderPage(TEMPLATE, sample()), first.page);
    expect(second.document.querySelector('.owed[data-id="discussion_r7001"]')?.classList.contains('handled')).toBe(
      true
    );
  });

  test('filters narrow by person, people only and new only, and hide empty folds', () => {
    const { visible, click, document } = open(renderPage(TEMPLATE, sample()));
    click('people only');
    expect(visible('.owed').map((node) => (node as HTMLElement).dataset.who)).toEqual(['bob', 'bob']);
    click('people only');
    click('lintbot');
    expect(visible('.owed').map((node) => (node as HTMLElement).dataset.id)).toEqual(['discussion_r7002']);
    expect(document.getElementById('issue-40')?.classList.contains('hidden')).toBe(false);
    click('everyone');
    click('new only');
    expect(visible('.owed')).toHaveLength(2);
  });

  test('a first move jumps to its fold: opens it and its parents, clears a filter hiding it, and flashes it', () => {
    const { document, page, click } = open(renderPage(TEMPLATE, sample()));
    click('lintbot');
    const fold = document.getElementById('pr-51') as HTMLDetailsElement;
    expect(fold.classList.contains('hidden')).toBe(true);
    const jump = document.querySelector('#first-moves a.jump[href="#pr-51"]') as HTMLAnchorElement;
    expect(document.querySelector('#first-moves a.jump[href="#pr-51"] + a.out')?.getAttribute('href')).toBe('https://github.com/acme/app/pull/51');
    jump.dispatchEvent(new page.window.MouseEvent('click', { cancelable: true }));
    expect(fold.classList.contains('hidden')).toBe(false);
    expect(fold.open).toBe(true);
    expect((document.getElementById('reviews') as HTMLDetailsElement).open).toBe(true);
    expect(fold.classList.contains('flash')).toBe(true);
    expect(page.window.location.hash).toBe('#pr-51');
  });

  test('a jump into a nested PR opens the issue around it', () => {
    const { document, page } = open(renderPage(TEMPLATE, sample()));
    const issue = document.getElementById('issue-40') as HTMLDetailsElement;
    issue.open = false;
    document.querySelector('#first-moves a.jump[href="#pr-42"]')?.dispatchEvent(new page.window.MouseEvent('click', { cancelable: true }));
    expect(issue.open).toBe(true);
    expect((document.getElementById('pr-42') as HTMLDetailsElement).open).toBe(true);
  });

  test('Copy copies the exact reply text', async () => {
    const { document, page } = open(renderPage(TEMPLATE, sample()));
    const copied: string[] = [];
    Object.defineProperty(page.window.navigator, 'clipboard', {
      value: { writeText: async (value: string) => void copied.push(value) }
    });
    const copy = document.querySelector('.owed[data-id="issuecomment-9001"] .paste button.copy') as HTMLButtonElement;
    copy.dispatchEvent(new page.window.MouseEvent('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(copied[0]).toStartWith('Lowercasing fixes case but not accents');
  });

  test('a description folds under its PR link with the kind, and copies the exact title and raw body', async () => {
    const { document, page } = open(renderPage(TEMPLATE, sample()));
    const copied: string[] = [];
    Object.defineProperty(page.window.navigator, 'clipboard', {
      value: { writeText: async (value: string) => void copied.push(value) }
    });
    const [update, opened] = [...document.querySelectorAll('#descriptions .tick.desc')];
    const link = update?.querySelector('summary a');
    expect(link?.getAttribute('href')).toBe('https://github.com/acme/app/pull/42');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(update?.querySelector('summary')?.textContent).toContain('update');
    expect(opened?.querySelector('summary')?.textContent).toContain('open PR → main');
    const [title, body] = [...(update?.querySelectorAll('.paste') ?? [])];
    title?.querySelector('button.copy')?.dispatchEvent(new page.window.MouseEvent('click'));
    body?.querySelector('button.copy')?.dispatchEvent(new page.window.MouseEvent('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pr = (sample().descriptions as Data[])[0];
    expect(copied).toEqual([String(pr?.title), String(pr?.body)]);
    expect(body?.querySelector('.md h4')?.textContent).toBe('Summary');
  });

  test('a long body peeks until Show all; a short one shows whole', () => {
    const { document, page } = open(renderPage(TEMPLATE, sample()));
    const [update, opened] = [...document.querySelectorAll('#descriptions .tick.desc')];
    const clip = update?.querySelector('.clip');
    const more = update?.querySelector('button.more');
    expect(clip?.classList.contains('open')).toBe(false);
    more?.dispatchEvent(new page.window.MouseEvent('click'));
    expect(clip?.classList.contains('open')).toBe(true);
    expect(more?.textContent).toBe('Show less');
    expect(opened?.querySelector('.clip')).toBeNull();
  });

  test('a description tick survives a reload of the same draft and clears on a new one', () => {
    const first = open(renderPage(TEMPLATE, sample()));
    const box = first.document.querySelector('.desc[data-ref="#42"] input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new first.page.window.Event('change'));
    expect(first.document.querySelector('#descriptions > summary [data-count]')?.textContent).toBe('1 of 2 left');
    const same = open(renderPage(TEMPLATE, sample()), first.page);
    expect(same.document.querySelector('.desc[data-ref="#42"]')?.classList.contains('handled')).toBe(true);
    const data = sample();
    const redrafted = (data.descriptions as Data[]).map((entry) => ({
      ...entry,
      body: `${String(entry.body)}\n\nMore.`
    }));
    const next = open(renderPage(TEMPLATE, { ...data, descriptions: redrafted }), first.page);
    expect(next.document.querySelector('.desc[data-ref="#42"]')?.classList.contains('handled')).toBe(false);
  });

  test('comment text renders as text, never as markup', () => {
    const data = sample();
    const issues = (data.issues as Data[]).map((issue) => ({
      ...issue,
      owed: (issue.owed as Data[]).map((owed) => ({
        ...owed,
        point: '<img src=x onerror=alert(1)>',
        url: 'javascript:alert(1)'
      }))
    }));
    const { document, errors } = open(renderPage(TEMPLATE, { ...data, issues }));
    expect(errors).toEqual([]);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
