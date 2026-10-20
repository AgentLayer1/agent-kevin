import { describe, expect, test } from 'bun:test';
import { htmlToText } from './html-to-markdown';

describe('htmlToText', () => {
  test('converts markup to readable text and keeps links', async () => {
    const text = await htmlToText('<p>Export <b>failed</b> — see <a href="https://acme.test/r/1">the report</a></p>');
    expect(text).toContain('Export **failed**');
    expect(text).toContain('https://acme.test/r/1');
  });

  test('empty input', async () => {
    expect(await htmlToText(undefined)).toBe('');
  });
});
