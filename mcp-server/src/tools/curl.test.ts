import { describe, expect, test } from 'bun:test';
import { findBlockedFlag, interpolateArgs, scrub } from './curl';

describe('interpolateArgs', () => {
  test('substitutes placeholders from the env map', () => {
    const args = ['-H', 'authorization: Bearer {{API_KEY}}', 'https://api.example.com'];
    expect(interpolateArgs(args, { API_KEY: 'sk-123456' })).toEqual([
      '-H',
      'authorization: Bearer sk-123456',
      'https://api.example.com'
    ]);
  });

  test('throws listing missing key names, never values', () => {
    expect(() => interpolateArgs(['{{MISSING_A}}', '{{MISSING_B}}'], { OTHER: 'x' })).toThrow(
      /MISSING_A, MISSING_B/
    );
  });

  test('empty value counts as missing', () => {
    expect(() => interpolateArgs(['{{EMPTY}}'], { EMPTY: '' })).toThrow(/EMPTY/);
  });

  test('args without placeholders pass through untouched', () => {
    expect(interpolateArgs(['-X', 'POST'], {})).toEqual(['-X', 'POST']);
  });
});

describe('scrub', () => {
  test('replaces every secret value with its placeholder', () => {
    const env = { API_KEY: 'sk-live-abcdef' };
    expect(scrub('authorization: Bearer sk-live-abcdef body sk-live-abcdef', env)).toBe(
      'authorization: Bearer {{API_KEY}} body {{API_KEY}}'
    );
  });

  test('longest value scrubs first so substrings cannot partially leak', () => {
    const env = { TOKEN: 'abc123', TOKEN_FULL: 'abc123-xyz789' };
    expect(scrub('value=abc123-xyz789', env)).toBe('value={{TOKEN_FULL}}');
  });

  test('short values (<4 chars) are not scrubbed to avoid mangling output', () => {
    expect(scrub('status 200 ok', { PORT: '200' })).toBe('status 200 ok');
  });
});

describe('findBlockedFlag', () => {
  test('flags file-writing options', () => {
    expect(findBlockedFlag(['-sS', '-o', 'out.bin'])).toBe('-o');
    expect(findBlockedFlag(['--cookie-jar', 'jar.txt'])).toBe('--cookie-jar');
    expect(findBlockedFlag(['--output=x.bin'])).toBe('--output=x.bin');
  });

  test('catches attached values and short-flag clusters', () => {
    expect(findBlockedFlag(['-oout.bin'])).toBe('-oout.bin');
    expect(findBlockedFlag(['-sSo', 'out.bin'])).toBe('-sSo');
    expect(findBlockedFlag(['-sSD', 'headers.txt'])).toBe('-sSD');
  });

  test('allows normal request flags', () => {
    expect(findBlockedFlag(['-X', 'POST', '-H', 'content-type: application/json', '-d', '{}'])).toBeUndefined();
    expect(findBlockedFlag(['-sSL', '-u', 'user:pass', 'https://api.example.com'])).toBeUndefined();
  });
});
