import { describe, expect, test } from 'bun:test';
import { isValidTransition } from './schema';

describe('isValidTransition', () => {
  test('a blocked task can be cancelled outright', () => {
    // Killing abandoned work is common, and routing it blocked -> active -> cancelled
    // parked the task in `active` between the two hops, lying in the dashboard.
    expect(isValidTransition('blocked', 'cancelled')).toBe(true);
  });

  test('blocked still cannot jump straight to done', () => {
    expect(isValidTransition('blocked', 'done')).toBe(false);
  });

  test('cancelled is terminal', () => {
    expect(isValidTransition('cancelled', 'open')).toBe(false);
    expect(isValidTransition('cancelled', 'active')).toBe(false);
  });
});
