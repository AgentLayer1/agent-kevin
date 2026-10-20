import { describe, expect, test } from 'bun:test';
import { sinceToStartTime } from './date';

const NOW = new Date('2026-07-28T12:00:00.000Z');

describe('sinceToStartTime', () => {
  test('hours', () => {
    expect(sinceToStartTime('6h', NOW)).toBe('2026-07-28T06:00:00.000Z');
  });

  test('days', () => {
    expect(sinceToStartTime('7d', NOW)).toBe('2026-07-21T12:00:00.000Z');
  });

  test('weeks', () => {
    expect(sinceToStartTime('2w', NOW)).toBe('2026-07-14T12:00:00.000Z');
  });

  test('rejects malformed input', () => {
    expect(() => sinceToStartTime('7 days', NOW)).toThrow('Invalid `since`');
  });
});
