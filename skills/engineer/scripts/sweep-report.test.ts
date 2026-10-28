import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord, isScriptSafe, readJsonBlock } from '../../../mcp-server/src/shared/json-block';
import {
  BLOCK_ID,
  PAGE_TOKEN,
  TEMPLATE_PATH,
  cardMismatch,
  checkPage,
  countsOf,
  renderPage,
  reportArgs,
  validate
} from './sweep-report';

const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf-8');
const SCRIPT = join(import.meta.dir, 'sweep-report.ts');
const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

type Data = Record<string, unknown>;

const sample = (): Data => {
  const read = readJsonBlock(TEMPLATE, BLOCK_ID);
  if (read?.kind !== 'data' || !isRecord(read.data)) {
    throw new Error('template has no readable sample');
  }
  return read.data;
};

const firstPr = (data: Data): Data => (Array.isArray(data.prs) && isRecord(data.prs[0]) ? data.prs[0] : {});

const withOwed = (owed: Data): Data => {
  const data = sample();
  const pr = firstPr(data);
  return { ...data, prs: [{ ...pr, owed: [owed] }, ...(data.prs as Data[]).slice(1)] };
};

const owed = (overrides: Data = {}): Data => ({
  id: 'discussion_r1',
  url: 'https://github.com/acme/app/pull/42#discussion_r1',
  who: 'bob',
  kind: 'person',
  at: '2026-10-28T03:00:00Z',
  new: true,
  where: 'inline',
  point: 'A point',
  reply: 'An answer.',
  confidence: 'confirmed',
  ...overrides
});

const run = (...args: string[]) => {
  const proc = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, NODE_PATH: join(import.meta.dir, '..', '..', '..', 'mcp-server', 'node_modules') }
  });
  return { status: proc.status, out: proc.stdout.toString(), err: proc.stderr.toString() };
};

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-report-'));
  dirs.push(dir);
  return dir;
};

describe('validate', () => {
  test('the template sample is valid', () => {
    expect(validate(sample())).toEqual({ errors: [], warnings: [] });
  });

  test('unknown keys are errors, so nothing silently disappears', () => {
    expect(validate({ ...sample(), extraSection: [] }).errors).toContain('data: unknown key "extraSection"');
    expect(validate(withOwed(owed({ severity: 'high' }))).errors).toContain('prs[0].owed[0]: unknown key "severity"');
  });

  test('an owed item needs a reply or an action, a real kind and a GitHub link', () => {
    const errors = validate(withOwed(owed({ reply: undefined, kind: 'robot', url: 'javascript:alert(1)' }))).errors;
    expect(errors).toContain('prs[0].owed[0] needs a reply or an action');
    expect(errors).toContain('prs[0].owed[0].kind must be one of person, bot');
    expect(errors).toContain('prs[0].owed[0].url must be a https://github.com/ link');
  });

  test('a comment belongs to one item', () => {
    const data = withOwed(owed({ id: 'issuecomment-9001' }));
    expect(validate(data).errors).toContain(
      'owed id "issuecomment-9001" appears twice; each comment belongs to one item'
    );
  });

  test('first moves are capped', () => {
    const moves = Array.from({ length: 11 }, (_, i) => ({ ref: `#${i + 1}`, what: 'x' }));
    expect(validate({ ...sample(), firstMoves: moves }).errors).toContain(
      'firstMoves holds at most 10; the rest live in their sections'
    );
  });

  test('a link to a PR outside the sweep is a warning, not an error', () => {
    const data = sample();
    const issues = (data.issues as Data[]).map((issue) => ({ ...issue, prs: [42, 99] }));
    const result = validate({ ...data, issues });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain("issue #40 links PR #99, which isn't in prs; it shows as a plain reference");
  });
});

describe('card', () => {
  test('counts come from the data, not from hand-typed numbers', () => {
    expect(countsOf(sample())).toEqual({ owed: 3, newOwed: 2, reviews: 0, pending: 1, conflicts: 1, needsCode: 1 });
  });

  test('report_write arguments carry the counts, the supersedes link and the page token', () => {
    const args = reportArgs(sample());
    expect(args.status).toBe('findings');
    expect(args.extra).toEqual({
      repo: 'acme/app',
      generatedAt: '2026-10-28T05:30:00Z',
      supersedes: 'reviews/2026-10-27-0900-github-sweep.md',
      owed: 3,
      reviews: 0,
      conflicts: 1
    });
    expect(args.body).toContain('**Waiting on you:** 3 replies owed (2 new)');
    expect(args.body).toContain('1. **#42** Answer Bob');
    expect(args.body).toContain(`(${PAGE_TOKEN})`);
  });

  test('a sweep with nothing owed is clean', () => {
    const data = sample();
    const prs = (data.prs as Data[]).map((pr) => ({ ...pr, owed: [], review: 'none' }));
    const issues = (data.issues as Data[]).map((issue) => ({ ...issue, owed: [] }));
    expect(reportArgs({ ...data, prs, issues }).status).toBe('clean');
  });
});

describe('page', () => {
  test('the data block stays script-safe when a comment holds markup', () => {
    const html = renderPage(TEMPLATE, withOwed(owed({ reply: '</script><script>alert(1)</script> <!-- x' })));
    const read = readJsonBlock(html, BLOCK_ID);
    expect(read?.kind).toBe('data');
    expect(read?.kind === 'data' && isScriptSafe(read.raw)).toBe(true);
    expect(checkPage(html).errors).toEqual([]);
  });

  test('a card from another run is refused', () => {
    const saved = `---\nstatus: findings\nrepo: acme/app\ngeneratedAt: "2026-10-28T05:30:00Z"\n---\nbody\n`;
    expect(cardMismatch(saved, sample())).toBeNull();
    expect(cardMismatch(saved, { ...sample(), generatedAt: '2026-10-29T05:30:00Z' })).toStartWith(
      'the card was saved with generatedAt: 2026-10-28T05:30:00Z, but the data gives generatedAt: 2026-10-29T05:30:00Z'
    );
  });
});

describe('cli', () => {
  test('card then write links the saved card to its page', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'data.json'), JSON.stringify(sample()));
    const card = run('card', join(dir, 'data.json'));
    expect(card.status).toBe(0);
    const args: unknown = JSON.parse(card.out);
    const body = isRecord(args) ? String(args.body) : '';
    writeFileSync(
      join(dir, 's.md'),
      `---\ntitle: x\nstatus: findings\nrepo: acme/app\ngeneratedAt: 2026-10-28T05:30:00Z\n---\n${body}`
    );
    const written = run('write', join(dir, 'data.json'), join(dir, 's.md'));
    expect(written.status).toBe(0);
    expect(readFileSync(join(dir, 's.md'), 'utf-8')).toContain('[Open the sweep page](s.html)');
    expect(checkPage(readFileSync(join(dir, 's.html'), 'utf-8')).errors).toEqual([]);
  });

  test('write refuses a missing card and writes no page', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'data.json'), JSON.stringify(sample()));
    const result = run('write', join(dir, 'data.json'), join(dir, 'missing.md'));
    expect(result.status).toBe(1);
    expect(existsSync(join(dir, 'missing.html'))).toBe(false);
  });

  test('invalid data fails card with the errors listed', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'data.json'), JSON.stringify({ ...sample(), repo: 'not a repo' }));
    const result = run('card', join(dir, 'data.json'));
    expect(result.status).toBe(1);
    expect(result.err).toContain('error: data.repo must be owner/name');
  });
});
