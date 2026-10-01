import { describe, expect, test } from 'bun:test';
import { BROWSER } from '@/config';
import { join } from 'node:path';
import { insideCaptures, label, stampedDir } from './files';

describe('insideCaptures', () => {
  test('accepts a folder under the captures dir', () => {
    const dir = join(BROWSER.CAPTURES_DIR, '2026-01-02-clip');
    expect(insideCaptures(dir)).toBe(dir);
    expect(insideCaptures(join(BROWSER.CAPTURES_DIR, '..clip'))).toBe(join(BROWSER.CAPTURES_DIR, '..clip'));
  });

  test('refuses the captures dir itself and anything outside it', () => {
    expect(() => insideCaptures(BROWSER.CAPTURES_DIR)).toThrow('must be inside');
    expect(() => insideCaptures(join(BROWSER.CAPTURES_DIR, '..', 'plans'))).toThrow('must be inside');
    expect(() => insideCaptures('/etc')).toThrow('must be inside');
  });
});

describe('stampedDir', () => {
  test('keeps a hostile name inside its parent', () => {
    expect(() => insideCaptures(stampedDir(BROWSER.CAPTURES_DIR, '../../etc/x'))).not.toThrow();
  });
});

describe('label', () => {
  test('never rounds up to a 60th second', () => {
    expect(label(59.6)).toBe('00:59');
    expect(label(3599.9)).toBe('59:59');
  });
});
