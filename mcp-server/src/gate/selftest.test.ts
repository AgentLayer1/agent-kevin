import { describe, expect, test } from 'bun:test';
import { judgeSelftest, selftestProbes } from './selftest';

const probes = selftestProbes({
  checkout: '/dev/acme',
  scratch: '/scratch',
  serverPid: 42,
  home: '/Users/dev',
  listening: [5432, 55432],
  allowedPorts: [55432]
});
const report = (outcomes: Record<string, string>) =>
  JSON.stringify(
    probes.map((probe) => ({ name: probe.name, outcome: outcomes[probe.name] ?? probe.expect, detail: 'x' }))
  );

describe('judgeSelftest', () => {
  test('passes only when every escape is refused and every control works', () => {
    expect(judgeSelftest(probes, report({})).every((probe) => probe.ok)).toBe(true);
  });

  test('a service already listening that the step could reach fails the probe', () => {
    const name = 'connect to any service already listening (dev database, API, containers)';
    const judged = judgeSelftest(probes, report({ [name]: 'allowed' }));

    expect(judged.find((probe) => probe.name === name)?.ok).toBe(false);
  });

  test("the run's own service is never in the list of listening services to refuse", () => {
    expect(probes.find((probe) => probe.kind === 'tcp-each')?.target).toBe('5432');
  });

  test("a step that can't reach a port it opened itself fails: a Next.js build would too", () => {
    const name = "connect to a port the step opened itself, as a bundler's workers do (control)";

    expect(judgeSelftest(probes, report({ [name]: 'blocked' })).find((probe) => probe.name === name)?.ok).toBe(false);
  });

  test("a blocked control (the run's own database) fails too: its migrations could not run", () => {
    const name = 'connect to port 55432, a service this run started (control)';

    expect(judgeSelftest(probes, report({ [name]: 'blocked' })).find((probe) => probe.name === name)?.ok).toBe(false);
  });

  test('with no services there is no control to reach, and every listening port is refused', () => {
    const bare = selftestProbes({
      checkout: '/dev/acme',
      scratch: '/scratch',
      serverPid: 42,
      home: '/Users/dev',
      listening: [5432, 55432]
    });

    expect(bare.some((probe) => probe.name.includes('a service this run started'))).toBe(false);
    expect(bare.find((probe) => probe.kind === 'tcp-each')?.target).toBe('5432,55432');
  });

  test('no output from the script fails every probe rather than passing silently', () => {
    expect(judgeSelftest(probes, '').some((probe) => probe.ok)).toBe(false);
  });
});
