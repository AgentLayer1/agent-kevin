import { describe, expect, test } from 'bun:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { isRecord, readJsonBlock } from '@/shared/json-block';
import { BLOCK_ID, TEMPLATE_PATH, renderPage } from '../../skills/engineer/scripts/pr-report';

// The engineer skill's PR report page renders entirely in the browser, so its script is run here against real data.
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf-8');

type Data = Record<string, unknown>;

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
  const { document } = new JSDOM(html, { runScripts: 'dangerously', virtualConsole, url: 'file:///report.html' }).window;
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
    expect(document.querySelector('section#bots a[href="#finding-1"]')).not.toBeNull();
    // Three comment cards, the same three inside their files, the bot reply and the summary comment.
    expect(count('.paste button')).toBe(8);
    expect(document.querySelector('.riskwhy')?.textContent).toStartWith('Risk L: ');
  });

  test('a clean review with no flows and no findings still renders', () => {
    const { flows: _flows, findings: _findings, bots: _bots, ...data } = sample();
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
