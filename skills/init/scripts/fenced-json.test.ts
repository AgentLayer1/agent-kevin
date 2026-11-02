import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  test("the init skill's auto-mode block survives a CRLF conversion", () => {
    const skill = readFileSync(resolve(import.meta.dir, '..', 'SKILL.md'), 'utf-8').replace(/\n/g, '\r\n');
    const block = fencedJsonAfter<{ autoMode: { allow: string[] } }>(
      skill,
      '### Offer the auto-mode knowledge-base exception'
    );
    expect(block.autoMode.allow.length).toBeGreaterThan(0);
  });
});
