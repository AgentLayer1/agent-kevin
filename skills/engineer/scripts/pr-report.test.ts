import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord, isScriptSafe, readJsonBlock } from '../../../mcp-server/src/shared/json-block';
import { BLOCK_ID, PAGE_TOKEN, TEMPLATE_PATH, cardMismatch, checkPage, relinkCard, renderCard, renderPage, reportArgs, statusOf, validate } from './pr-report';

const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf-8');
const SCRIPT = join(import.meta.dir, 'pr-report.ts');
const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

type Data = Record<string, unknown>;

const rowsOf = (value: unknown): Data[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const sampleReview = (): Data => {
  const read = readJsonBlock(TEMPLATE, BLOCK_ID);
  if (read?.kind !== 'data' || !isRecord(read.data)) {
    throw new Error('template has no readable sample');
  }
  return read.data;
};

const replies = (): Data => ({
  kind: 'replies',
  pr: { number: 52, title: 'Count every call toward the rate limit', author: 'ada', repo: 'acme/shop', head: '9ab12cd', base: 'main' },
  summary: 'Two threads from Grace. The fix is in the working tree, not committed.',
  threads: [
    {
      id: 'discussion_r4011695208',
      url: 'https://github.com/acme/shop/pull/52#discussion_r4011695208',
      where: 'inline',
      anchor: 'src/limits.ts:14',
      reviewer: 'grace',
      point: 'Rejected calls skip the limit',
      quote: 'Excluding failed requests cuts both ways',
      status: 'to-post',
      reply: 'Changed. The rate limit counts every call, rejected ones included.\n\n```suggestion\nconst counted = calls;\n```'
    },
    {
      id: 'issuecomment-5686065667',
      url: 'https://github.com/acme/shop/pull/52#issuecomment-5686065667',
      where: 'conversation',
      reviewer: 'coderabbitai[bot]',
      bot: true,
      point: 'Walkthrough summary',
      quote: 'This PR changes how calls are counted',
      status: 'posted'
    }
  ],
  commits: [{ subject: 'Count rejected calls toward the rate limit', body: 'Grace asked for it on discussion_r4011695208.' }],
  stillOpen: ['The per-endpoint limits need a measurement before they change.']
});

const firstThread = (data: Data): Data => rowsOf(data.threads)[0];

const withThread = (data: Data, change: Data): Data => ({ ...data, threads: [{ ...firstThread(data), ...change }, ...rowsOf(data.threads).slice(1)] });

const withFinding = (data: Data, index: number, change: Data): Data => ({
  ...data,
  findings: rowsOf(data.findings).map((finding, i) => (i === index ? { ...finding, ...change } : finding))
});

const run = (...args: string[]) => {
  const proc = spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, NODE_PATH: join(import.meta.dir, '..', '..', '..', 'mcp-server', 'node_modules') } });
  return { status: proc.status, out: proc.stdout.toString(), err: proc.stderr.toString() };
};

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-report-'));
  dirs.push(dir);
  return dir;
};

describe('validate', () => {
  test('the template sample is a valid review and hands back its diagrams', () => {
    const result = validate(sampleReview());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.diagrams.map((diagram) => diagram.flow)).toEqual(['Placing an order', 'Cancelling an order']);
  });

  test('a replies report with a posted thread and no reply is valid', () => {
    expect(validate(replies()).errors).toEqual([]);
  });

  test('a thread still to post needs its reply', () => {
    expect(validate(withThread(replies(), { reply: '' })).errors).toEqual(['threads[0].reply must be non-empty text unless the thread is posted']);
  });

  test('a thread url must be the comment on this PR, so a javascript: url is refused', () => {
    const errors = validate(withThread(replies(), { url: 'javascript:alert(1)' })).errors;
    expect(errors).toEqual(['threads[0].url must be https://github.com/acme/shop/pull/52#discussion_r4011695208, got "javascript:alert(1)"']);
  });

  test('a thread id is the full URL fragment', () => {
    const errors = validate(withThread(replies(), { id: 'r4011695208', url: 'https://github.com/acme/shop/pull/52#r4011695208' })).errors;
    expect(errors[0]).toStartWith("threads[0].id must be the comment's URL fragment");
  });

  test('a stacked thread links to its own PR', () => {
    const change = { pr: 51, url: 'https://github.com/acme/shop/pull/51#discussion_r4011695208' };
    expect(validate(withThread(replies(), change)).errors).toEqual([]);
  });

  test('the repo must be owner/name', () => {
    const data = replies();
    expect(validate({ ...data, pr: { ...(isRecord(data.pr) ? data.pr : {}), repo: 'shop' } }).errors).toContain('pr.repo must be owner/name, got "shop"');
  });

  test('a nit may anchor to a whole file, a finding may not', () => {
    const errors = validate(withFinding(sampleReview(), 0, { anchor: 'src/orders/edit.ts' })).errors;
    expect(errors).toEqual(['findings[0].anchor must be "path:line" or "path:start-end" with start ≤ end, got "src/orders/edit.ts"']);
  });

  test('a reversed range and a finding outside the file list fail', () => {
    expect(validate(withFinding(sampleReview(), 0, { anchor: 'src/orders/edit.ts:31-22' })).errors[0]).toStartWith('findings[0].anchor must be');
    expect(validate(withFinding(sampleReview(), 0, { anchor: 'src/elsewhere.ts:3' })).errors).toEqual(['findings[0].anchor names a file missing from files']);
  });

  test('a blocker needs its failure and evidence, and a lane from the list', () => {
    const errors = validate(withFinding(sampleReview(), 0, { failure: '', lanes: ['races'] })).errors;
    expect(errors).toEqual([
      'findings[0].lanes[0] must be one of correctness | invariants | security | regressions | conventions | tests | hygiene | generated-code | performance | case-against | gate | bot:<login>, got "races"',
      'findings[0].failure must be non-empty text'
    ]);
  });

  test('a confirmed bot comment names its finding, and a false positive its reason', () => {
    const confirmed = validate({ ...sampleReview(), bots: [{ bot: 'copilot', claim: 'x', disposition: 'confirmed' }] }).errors;
    expect(confirmed).toEqual(['bots[0].finding must name the finding a confirmed bot comment became']);
    const missing = validate({ ...sampleReview(), bots: [{ bot: 'copilot', claim: 'x', disposition: 'confirmed', finding: 9 }] }).errors;
    expect(missing).toEqual(['bots[0].finding points at no finding id']);
    const falsePositive = validate({ ...sampleReview(), bots: [{ bot: 'copilot', claim: 'x', disposition: 'false-positive' }] }).errors;
    expect(falsePositive).toEqual(['bots[0].reason must say why it is a false positive', "bots[0].reply must give the operator a reply to paste on the bot's thread"]);
  });

  test('How it works needs an explanation or a flow, not always a diagram', () => {
    const { flows: _flows, ...withoutFlows } = sampleReview();
    expect(validate(withoutFlows).errors).toEqual([]);
    const { explanation: _explanation, ...bare } = withoutFlows;
    expect(validate(bare).errors).toEqual(['How it works needs an explanation or at least one flow']);
  });

  test('hunk lines must be a line or a range', () => {
    const data = sampleReview();
    const files = rowsOf(data.files).map((file, i) => (i === 0 ? { ...file, hunks: [{ lines: 'L41, 90-95', text: 'x' }] } : file));
    expect(validate({ ...data, files }).errors).toEqual(['files[0].hunks[0].lines must be "line" or "start-end" with start ≤ end, got "L41, 90-95"']);
  });

  test('a title must be one line', () => {
    expect(validate(withFinding(sampleReview(), 0, { title: 'a\n## injected' })).errors).toEqual(['findings[0].title must be one line']);
  });

  test('a misspelled or singular key is an error, not a silently missing section', () => {
    const { lanes: _lanes, ...finding } = rowsOf(sampleReview().findings)[0];
    const data = { ...sampleReview(), verifiedclean: ['x'], findings: [{ ...finding, lane: 'security' }, ...rowsOf(sampleReview().findings).slice(1)] };
    expect(validate(data).errors).toEqual([
      'verifiedclean is not a field',
      'findings[0].lanes must list every source that raised it',
      'findings[0].lane is not a field (use lanes, a list)'
    ]);
  });

  test('the verdict must agree with the findings', () => {
    expect(validate({ ...sampleReview(), verdict: 'approve' }).errors).toEqual(['verdict: approve leaves no blocker, fix-before-merge or question']);
    const noBlockers = rowsOf(sampleReview().findings).filter((finding) => finding.severity !== 'blocker');
    const bots = rowsOf(sampleReview().bots).filter((bot) => bot.disposition !== 'confirmed');
    expect(validate({ ...sampleReview(), findings: noBlockers, bots, verdict: 'do-not-merge' }).errors).toEqual(['verdict: do-not-merge needs a blocker']);
  });

  test('a lookAt or decision anchor must name a file in files', () => {
    const data = sampleReview();
    expect(validate({ ...data, lookAt: [{ anchor: 'src/elsewhere.ts:1', why: 'x' }] }).errors).toEqual(['lookAt[0].anchor names a file missing from files']);
  });

  test('an approve with nothing verified clean warns', () => {
    const { verifiedClean: _clean, ...data } = sampleReview();
    expect(validate({ ...data, verdict: 'approve' }).warnings).toEqual(['an approve needs a verifiedClean list saying what was checked']);
  });
});

describe('card', () => {
  test('a review card lists every finding, question and bot comment, and links the page', () => {
    const card = renderCard(sampleReview());
    expect(card).toContain('# PR #418: Reserve stock when an order is placed, release it on cancel');
    expect(card).toContain('**Verdict** 🟠 Changes requested · **Risk** L');
    expect(card).toContain('- 🔴 #1 An edit that raises quantity can oversell: stock is read before the row lock · `src/orders/edit.ts:22`');
    expect(card).toContain('- 🟡 #2 2 nits in errors.ts · `src/web/checkout/errors.ts`');
    expect(card).toContain('## Questions for the author\n\n- ❓ #3');
    expect(card).toContain('coderabbitai\\[bot\\] · `src/orders/cancel.ts:19` · false-positive: Holds not deleted on refund failure');
    expect(card).toContain(`[open the review](${PAGE_TOKEN})`);
  });

  test('markdown in a single-line field is escaped, so it cannot add headings or links', () => {
    const card = renderCard(withThread(replies(), { point: 'see [here](javascript:x) <b>' }));
    expect(card).toContain('see \\[here\\](javascript:x) \\<b\\>');
  });

  test('the summary is escaped too, and a draft says so on the card', () => {
    const card = renderCard({ ...replies(), draft: true, summary: '# heading\n[click](javascript:x) %% hidden' });
    expect(card).toContain('> \\# heading\n> \\[click\\](javascript:x) %\\% hidden');
    expect(card).toContain('**Draft:**');
  });

  test('a replies card counts threads by status and links each one', () => {
    const card = renderCard(replies());
    expect(card).toContain('**Threads** 1 to post · 0 follow-up · 1 posted · 0 resolve only');
    expect(card).toContain(
      '- To post · grace · Rejected calls skip the limit · `src/limits.ts:14` · [discussion_r4011695208](https://github.com/acme/shop/pull/52#discussion_r4011695208)'
    );
  });

  test('a re-run card says what changed since the last report', () => {
    expect(renderCard({ ...replies(), sinceLast: ['discussion_r4011695208 answered since.'] })).toContain(
      '## Since the last run\n\n- discussion_r4011695208 answered since.'
    );
  });
});

describe('report_write arguments', () => {
  test('status, blockers and summary come from the data', () => {
    const args = reportArgs(sampleReview());
    expect(args.status).toBe('findings');
    expect(args.extra).toEqual({ pr: 418, author: 'ada', head: '3f9c2e1', base: 'main', mode: 'review', verdict: 'changes-requested', blockers: 1 });
    expect(String(args.summary)).not.toContain('\n');
  });

  test('a blocker on a security or invariants lane is critical; a draft is draft; replies are findings until posted', () => {
    expect(statusOf(withFinding(sampleReview(), 0, { lanes: ['security'] }))).toBe('critical');
    expect(statusOf({ ...sampleReview(), draft: true })).toBe('draft');
    expect(statusOf(replies())).toBe('findings');
    expect(statusOf(withThread(replies(), { status: 'posted' }))).toBe('clean');
  });
});

describe('page', () => {
  test('the page carries the data back exactly, escaped so PR text cannot close the script', () => {
    const data = replies();
    const hostile = withThread(
      { ...data, pr: { ...(isRecord(data.pr) ? data.pr : {}), title: 'Fix <b>bold</b> & more' } },
      { reply: 'ends the block </script><script>alert(1)</script>' }
    );
    const page = renderPage(TEMPLATE, hostile);
    const read = readJsonBlock(page, BLOCK_ID);
    expect(read?.kind === 'data' && isScriptSafe(read.raw)).toBe(true);
    expect(read?.kind === 'data' && read.data).toEqual(hostile);
    expect(page).toContain('<title>PR #52 replies — Fix &lt;b&gt;bold&lt;/b&gt; &amp; more</title>');
    expect(checkPage(page).errors).toEqual([]);
  });

  test('a hand-edited block with a raw "</" fails the check', () => {
    const page = renderPage(TEMPLATE, sampleReview()).replace('"summary": "', '"summary": "</div> ');
    expect(checkPage(page).errors).toContain('the data block holds an unescaped "</" or "<!--"');
  });

  test('relinking keeps the frontmatter and re-renders the body with the page link', () => {
    const saved = `---\ntitle: x\nstatus: findings\n---\n# stale body ${PAGE_TOKEN}\n`;
    const card = relinkCard(saved, replies(), 'pr-52-replies.html');
    expect(card).toStartWith('---\ntitle: x\nstatus: findings\n---\n# PR #52 replies: Count every call toward the rate limit');
    expect(card).toContain('[open the replies](pr-52-replies.html)');
    expect(card).not.toContain('stale body');
  });
});

describe('cli', () => {
  test('write refuses a card path that does not exist and writes no page', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'data.json'), JSON.stringify(replies()));
    const result = run('write', join(dir, 'data.json'), join(dir, 'missing.md'));
    expect(result.status).toBe(1);
    expect(result.err).toContain('no card at');
    expect(existsSync(join(dir, 'missing.html'))).toBe(false);
  });

  test('card prints the report_write arguments, and write links the saved card to its page', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'data.json'), JSON.stringify(replies()));
    const card = run('card', join(dir, 'data.json'));
    expect(card.status).toBe(0);
    const args: unknown = JSON.parse(card.out);
    const body = isRecord(args) ? String(args.body) : '';
    writeFileSync(join(dir, 'r.md'), `---\ntitle: x\nstatus: findings\npr: 52\nmode: reply\n---\n${body}`);
    const written = run('write', join(dir, 'data.json'), join(dir, 'r.md'));
    expect(written.status).toBe(0);
    expect(readFileSync(join(dir, 'r.md'), 'utf-8')).toContain('[open the replies](r.html)');
    expect(checkPage(readFileSync(join(dir, 'r.html'), 'utf-8')).errors).toEqual([]);
  });

  test('a card from another PR, or saved before the status changed, is refused', () => {
    const saved = `---\nstatus: findings\npr: 418\nmode: review\nverdict: changes-requested\nblockers: 1\n---\nbody ${PAGE_TOKEN}\n`;
    expect(cardMismatch(saved, sampleReview())).toBeNull();
    expect(cardMismatch(saved, replies())).toBe('the card is PR #418 (review), but the data is PR #52 (reply)');
    const fixed = rowsOf(sampleReview().findings).filter((finding) => finding.severity !== 'blocker');
    const bots = rowsOf(sampleReview().bots).filter((bot) => bot.disposition !== 'confirmed');
    expect(cardMismatch(saved, { ...sampleReview(), findings: fixed, bots, verdict: 'approve-with-fixes' })).toStartWith(
      'the card was saved with verdict: changes-requested, blockers: 1, but the data now gives verdict: approve-with-fixes, blockers: 0'
    );
  });

  test('bad JSON is a one-line error, not a stack trace', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'data.json'), '{ "kind": ');
    const result = run('card', join(dir, 'data.json'));
    expect(result.status).toBe(1);
    expect(result.err.trim().split('\n')).toHaveLength(1);
    expect(result.err).toStartWith('error: ');
  });
});
