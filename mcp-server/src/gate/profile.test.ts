import { describe, expect, test } from 'bun:test';
import { sandboxProfile } from './profile';

const base = {
  checkout: '/repo/acme',
  scratch: '/private/var/folders/x/agent-gate-1/tmp',
  home: '/Users/dev',
  listening: [5432, 8000, 55432]
};
const lines = (profile: string) => profile.split('\n');

describe('sandboxProfile', () => {
  test("network is one loopback rule that refuses every port already listening except the run's own services", () => {
    const profile = sandboxProfile({
      ...base,
      network: 'loopback',
      listening: [5432, 6379, 50000, 55432],
      allowedPorts: [55432]
    });
    const allow = lines(profile).filter((line) => line.startsWith('(allow network-outbound'));

    expect(lines(profile)).toContain('(deny network-outbound)');
    expect(allow).toEqual([
      '(allow network-outbound (require-all (remote ip "localhost:*") (require-not (remote ip "localhost:5432")) (require-not (remote ip "localhost:6379")) (require-not (remote ip "localhost:50000"))))'
    ]);
    expect(lines(profile)).not.toContain('(allow network-outbound)');
  });

  test('with no services, a port already listening stays refused, whichever it is', () => {
    const allow = lines(sandboxProfile({ ...base, network: 'loopback', listening: [55432] })).filter((line) =>
      line.startsWith('(allow network-outbound')
    );

    expect(allow.join('\n')).toContain('(require-not (remote ip "localhost:55432"))');
  });

  test('the profile stays small whatever is listening, so it compiles fast', () => {
    expect(sandboxProfile({ ...base, network: 'loopback' }).length).toBeLessThan(5_000);
  });

  test('an install adds HTTPS and DNS, never an unfiltered allow that would beat every deny', () => {
    const profile = sandboxProfile({ ...base, network: 'open' });

    expect(profile).toContain('(remote ip "*:443")');
    expect(profile).toContain('/private/var/run/mDNSResponder');
    expect(lines(profile)).not.toContain('(allow network-outbound)');
  });

  test('writes are denied by default, then opened for the checkout and scratch only, then the git dir is closed again', () => {
    const profile = lines(sandboxProfile({ ...base, network: 'loopback' }));
    const denyAll = profile.indexOf('(deny file-write*)');
    const allow = profile.findIndex((line) => line.startsWith('(allow file-write*'));
    const gitDeny = profile.findIndex((line) => line.includes('(subpath "/repo/acme/.git")'));

    expect(denyAll).toBeLessThan(allow);
    expect(profile[allow]).toContain('(subpath "/repo/acme")');
    expect(profile[allow]).toContain(`(subpath "${base.scratch}")`);
    expect(profile[allow]).not.toContain('/Users/dev"');
    expect(gitDeny).toBeGreaterThan(allow);
    expect(profile[gitDeny]).toStartWith('(deny file-write*');
  });

  test('extra writable paths (the pnpm store for an install) join the allow list', () => {
    const profile = sandboxProfile({ ...base, network: 'open', extraWritable: ['/Users/dev/Library/pnpm/store/v10'] });

    expect(profile).toContain('(subpath "/Users/dev/Library/pnpm/store/v10")');
  });

  test('a path with a quote or backslash stays one quoted string', () => {
    const profile = sandboxProfile({ ...base, checkout: '/repo/a"b\\c', network: 'loopback' });

    expect(profile).toContain('(subpath "/repo/a\\"b\\\\c")');
  });

  test('secrets are unreadable: ssh keys, cloud credentials, and .env files but not .env.example', () => {
    const profile = lines(sandboxProfile({ ...base, network: 'loopback' }));
    const denyRead = profile.findIndex((line) => line.startsWith('(deny file-read*'));
    const allowExample = profile.indexOf('(allow file-read* (regex #"/\\.env\\.example$"))');

    expect(profile[denyRead]).toContain('(subpath "/Users/dev/.ssh")');
    expect(profile[denyRead]).toContain('(subpath "/Users/dev/.aws")');
    expect(profile[denyRead]).toContain('(regex #"/\\.env(\\.[^/]+)?$")');
    expect(profile[denyRead]).toContain('(regex #"\\.pem$")');
    expect(profile[denyRead]).toContain('(regex #"/secrets(/|$)")');
    expect(profile[denyRead]).toContain('(literal "/Users/dev/.gem/credentials")');
    expect(allowExample).toBeGreaterThan(denyRead);
  });

  test('signals reach only processes inside the same sandbox', () => {
    const profile = lines(sandboxProfile({ ...base, network: 'loopback' }));

    expect(profile.indexOf('(allow signal (target same-sandbox))')).toBeGreaterThan(profile.indexOf('(deny signal)'));
  });
});
