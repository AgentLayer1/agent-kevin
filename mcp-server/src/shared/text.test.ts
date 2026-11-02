import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readText, toLf } from './text';

describe('toLf', () => {
  test('turns CRLF into LF and leaves LF and a lone CR alone', () => {
    expect(toLf('a\r\nb\r\n')).toBe('a\nb\n');
    expect(toLf('a\nb\n')).toBe('a\nb\n');
    expect(toLf('a\rb')).toBe('a\rb');
  });
});

describe('readText', () => {
  test('reads a CRLF file as LF', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'text-')), 'note.md');
    writeFileSync(file, '---\r\ntitle: Acme\r\n---\r\n');
    expect(readText(file)).toBe('---\ntitle: Acme\n---\n');
  });
});
