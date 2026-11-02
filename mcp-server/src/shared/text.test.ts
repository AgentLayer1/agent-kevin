import { describe, expect, test } from 'bun:test';
import { toLf } from './text';

describe('toLf', () => {
  test('turns CRLF into LF and leaves LF and a lone CR alone', () => {
    expect(toLf('a\r\nb\r\n')).toBe('a\nb\n');
    expect(toLf('a\nb\n')).toBe('a\nb\n');
    expect(toLf('a\rb')).toBe('a\rb');
  });
});
