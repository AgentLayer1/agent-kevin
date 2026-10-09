import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCK_ID, checkExplainer } from './explainer-check';

const TEMPLATE = readFileSync(join(import.meta.dir, '..', 'templates', 'explainer.html'), 'utf-8');
const BLOCK = new RegExp(`(<script type="application/json" id="${BLOCK_ID}">)([\\s\\S]*?)(</script>)`);

const templateData = (): Record<string, unknown> => {
  const match = BLOCK.exec(TEMPLATE);
  if (!match) {
    throw new Error('template has no data block');
  }
  return JSON.parse(match[2]);
};

const withBlock = (raw: string): string => TEMPLATE.replace(BLOCK, (_, open: string, __: string, close: string) => `${open}\n${raw}\n${close}`);

const withData = (edit: (data: Record<string, unknown>) => Record<string, unknown>): string =>
  withBlock(JSON.stringify(edit(templateData()), null, 2));

describe('explainer-check', () => {
  test('the shipped template passes and hands back its diagrams', () => {
    const result = checkExplainer(TEMPLATE);
    expect(result.errors).toEqual([]);
    expect(result.diagrams.map((diagram) => diagram.flow)).toEqual(['Placing an order', 'Cancelling an order']);
  });

  test('a page without the block fails', () => {
    expect(checkExplainer('<html><body></body></html>').errors).toEqual([`no <script id="${BLOCK_ID}"> block`]);
  });

  test('a block that is not JSON fails', () => {
    expect(checkExplainer(withBlock('{ "pr": ')).errors[0]).toStartWith(`${BLOCK_ID} is not valid JSON`);
  });

  test('a PR string that closes the script element fails', () => {
    const html = withData((data) => ({ ...data, summary: 'Breaks out with </script> in the summary' }));
    expect(checkExplainer(html).errors[0]).toStartWith(`${BLOCK_ID} is not valid JSON`);
  });

  test('an unescaped "</" anywhere in the block fails', () => {
    const html = withData((data) => ({ ...data, summary: 'A stray </div> from the PR body' }));
    expect(checkExplainer(html).errors).toEqual(['the data block holds an unescaped "</" or "<!--"; write "<\\/" instead']);
  });

  test('an anchor without a line number fails', () => {
    const html = withData((data) => ({ ...data, lookAt: [{ anchor: 'src/orders/edit.ts', why: 'the race' }] }));
    expect(checkExplainer(html).errors).toEqual(['lookAt[0].anchor must be "path:line" or "path:start-end", got "src/orders/edit.ts"']);
  });

  test('a file outside the three triage classes fails', () => {
    const html = withData((data) => ({ ...data, files: [{ path: 'a.ts', class: 'scary', concern: 'X', summary: 'y' }] }));
    expect(checkExplainer(html).errors).toEqual(['files[0].class must be one of risk | logic | mechanical, got "scary"']);
  });

  test('an unknown verdict fails', () => {
    const html = withData((data) => ({ ...data, verdict: 'lgtm' }));
    expect(checkExplainer(html).errors[0]).toStartWith('verdict must be one of');
  });

  test('a page with no flow fails', () => {
    const html = withData((data) => ({ ...data, flows: [] }));
    expect(checkExplainer(html).errors).toEqual(['flows needs at least one flow']);
  });

  test('more than five hunks to read warns but passes', () => {
    const look = Array.from({ length: 6 }, (_, i) => ({ anchor: `src/a.ts:${i + 1}`, why: 'read it' }));
    const result = checkExplainer(withData((data) => ({ ...data, lookAt: look })));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(['lookAt has 6 hunks; 5 at most keeps it a reading guide']);
  });
});
