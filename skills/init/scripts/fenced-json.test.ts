import { describe, expect, test } from 'bun:test';
import { fencedJsonAfter } from './fenced-json';

const markdown = ['## Intro', '', '### Baseline', '', '```json', '["Read(./a)", "Read(./b)"]', '```', ''].join('\n');

describe('fencedJsonAfter', () => {
  test('parses the fence after the anchor', () => {
    expect(fencedJsonAfter<string[]>(markdown, '### Baseline')).toEqual(['Read(./a)', 'Read(./b)']);
  });

  test('parses the same fence from a CRLF checkout', () => {
    expect(fencedJsonAfter<string[]>(markdown.replace(/\n/g, '\r\n'), '### Baseline')).toEqual([
      'Read(./a)',
      'Read(./b)'
    ]);
  });

  test('throws when the anchor is gone', () => {
    expect(() => fencedJsonAfter(markdown, '### Missing')).toThrow(
      'no longer carries a JSON block after "### Missing"'
    );
  });
});
