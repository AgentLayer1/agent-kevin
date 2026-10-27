import { describe, expect, test } from 'bun:test';
import { withBrowserLaunch } from './browser-deps';

const timeoutError = (): Error =>
  Object.assign(new Error('launch: Timeout 20000ms exceeded.'), { name: 'TimeoutError' });

/**
 * A launch that times out `failures` times, then returns 'browser'; records each call's timeout.
 */
const flakyLaunch = (failures: number) => {
  const timeouts: number[] = [];
  const launch = async (timeout: number): Promise<string> => {
    timeouts.push(timeout);
    if (timeouts.length <= failures) {
      throw timeoutError();
    }
    return 'browser';
  };
  return { launch, timeouts };
};

describe('withBrowserLaunch', () => {
  test('a launch that times out is retried with a short timeout', async () => {
    const { launch, timeouts } = flakyLaunch(2);
    expect(await withBrowserLaunch(launch)).toBe('browser');
    expect(timeouts).toHaveLength(3);
    expect(timeouts.every((timeout) => timeout < 180_000)).toBe(true);
  });

  test('gives up after three timed-out launches', async () => {
    const { launch, timeouts } = flakyLaunch(3);
    await expect(withBrowserLaunch(launch)).rejects.toThrow('Timeout');
    expect(timeouts).toHaveLength(3);
  });

  test('any other launch failure is not retried', async () => {
    let calls = 0;
    const launch = async (): Promise<string> => {
      calls += 1;
      throw new Error('Executable does not exist');
    };
    await expect(withBrowserLaunch(launch)).rejects.toThrow('Executable does not exist');
    expect(calls).toBe(1);
  });
});
