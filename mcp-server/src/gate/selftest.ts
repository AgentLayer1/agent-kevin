import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

type Expect = 'blocked' | 'allowed';

interface Probe {
  name: string;
  expect: Expect;
  kind: 'write' | 'read' | 'tcp' | 'tcp-own' | 'tcp-each' | 'unix' | 'signal';
  target: string;
}

interface ProbeResult extends Probe {
  outcome: Expect | 'skipped';
  detail: string;
  ok: boolean;
}

/**
 * Every escape the profile must refuse, each tried for real under it, with controls that must still work.
 * `ECONNREFUSED` means the connect got through the sandbox; only `EPERM` or `EACCES` is a refusal.
 */
export const selftestProbes = ({
  checkout,
  scratch,
  serverPid,
  listening,
  allowedPorts = [],
  home = homedir()
}: {
  checkout: string;
  scratch: string;
  serverPid: number;
  listening: number[];
  allowedPorts?: number[];
  home?: string;
}): Probe[] => [
  { name: 'write in scratch (control)', expect: 'allowed', kind: 'write', target: join(scratch, 'selftest-write') },
  {
    name: 'write in your home folder',
    expect: 'blocked',
    kind: 'write',
    target: join(home, `.agent-gate-selftest-${process.pid}`)
  },
  {
    name: "write the checkout's git dir (hooks run later, unsandboxed)",
    expect: 'blocked',
    kind: 'write',
    target: join(gitDir(checkout), 'agent-gate-selftest')
  },
  { name: 'read ~/.ssh', expect: 'blocked', kind: 'read', target: join(home, '.ssh') },
  { name: "read the checkout's .env", expect: 'blocked', kind: 'read', target: join(checkout, '.env') },
  ...allowedPorts.map(
    (port): Probe => ({
      name: `connect to port ${port}, a service this run started (control)`,
      expect: 'allowed',
      kind: 'tcp',
      target: `127.0.0.1:${port}`
    })
  ),
  {
    name: "connect to a port the step opened itself, as a bundler's workers do (control)",
    expect: 'allowed',
    kind: 'tcp-own',
    target: ''
  },
  {
    name: 'connect to any service already listening (dev database, API, containers)',
    expect: 'blocked',
    kind: 'tcp-each',
    target: listening.filter((port) => !allowedPorts.includes(port)).join(',')
  },
  { name: 'connect to the internet', expect: 'blocked', kind: 'tcp', target: '1.1.1.1:443' },
  ...dockerSockets(home)
    .filter((socket) => existsSync(socket))
    .map(
      (socket): Probe => ({ name: `connect to Docker (${socket})`, expect: 'blocked', kind: 'unix', target: socket })
    ),
  {
    name: 'signal a process outside the sandbox (the MCP server)',
    expect: 'blocked',
    kind: 'signal',
    target: String(serverPid)
  }
];

/** Every place a Docker or OrbStack daemon listens; reaching one is root on the machine. */
const dockerSockets = (home: string): string[] => [
  '/var/run/docker.sock',
  '/private/var/run/docker.sock',
  join(home, '.orbstack', 'run', 'docker.sock'),
  join(home, '.docker', 'run', 'docker.sock'),
  join(home, '.colima', 'default', 'docker.sock'),
  join(home, 'Library', 'Containers', 'com.docker.docker', 'Data', 'docker.raw.sock')
];

/**
 * A worktree's `.git` is a file pointing at its git dir inside the main checkout's `.git/worktrees/`.
 */
const gitDir = (checkout: string): string => {
  const dotGit = join(checkout, '.git');
  try {
    if (statSync(dotGit).isDirectory()) {
      return dotGit;
    }
    const pointer = readFileSync(dotGit, 'utf8')
      .match(/^gitdir:\s*(.+)$/m)?.[1]
      ?.trim();
    return pointer ? resolve(checkout, pointer) : dotGit;
  } catch {
    return dotGit;
  }
};

/**
 * Node script run under the profile: tries each probe and prints one JSON line of `{name, outcome, detail}`.
 */
export const SELFTEST_SCRIPT = `
const fs = require('node:fs');
const net = require('node:net');
const probes = JSON.parse(process.argv[2]);
const refused = (error) => error && (error.code === 'EPERM' || error.code === 'EACCES');
const connect = (options) => new Promise((resolve) => {
  const socket = net.connect(options);
  const done = (outcome, detail) => { socket.destroy(); resolve({ outcome, detail }); };
  socket.setTimeout(3000, () => done('allowed', 'timed out (not refused by the sandbox)'));
  socket.once('connect', () => done('allowed', 'connected'));
  socket.once('error', (error) => done(refused(error) ? 'blocked' : 'allowed', error.code));
});
const attempt = async ({ kind, target }) => {
  try {
    if (kind === 'write') { fs.writeFileSync(target, 'x'); fs.rmSync(target, { force: true }); return { outcome: 'allowed', detail: 'written' }; }
    if (kind === 'read') { fs.statSync(target); return { outcome: 'allowed', detail: 'readable' }; }
    if (kind === 'signal') { process.kill(Number(target), 0); return { outcome: 'allowed', detail: 'signalled' }; }
    if (kind === 'unix') { return await connect({ path: target }); }
    if (kind === 'tcp-own') {
      const server = net.createServer((socket) => socket.destroy());
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const result = await connect({ host: '127.0.0.1', port: server.address().port });
      server.close();
      return result;
    }
    if (kind === 'tcp-each') {
      const ports = target ? target.split(',') : [];
      if (!ports.length) { return { outcome: 'skipped', detail: 'nothing else listening' }; }
      const tried = await Promise.all(ports.map(async (port) => {
        const results = await Promise.all(['127.0.0.1', '::1'].map((host) => connect({ host, port: Number(port) })));
        const through = results.some((result) => result.detail === 'connected') || !results.some((result) => result.outcome === 'blocked');
        return { port, through };
      }));
      const leaks = tried.filter((item) => item.through).map((item) => item.port);
      return leaks.length ? { outcome: 'allowed', detail: 'reached ports ' + leaks.join(', ') } : { outcome: 'blocked', detail: 'all ' + ports.length + ' refused (' + ports.join(', ') + ')' };
    }
    const [host, port] = target.split(':');
    return await connect({ host, port: Number(port) });
  } catch (error) {
    if (error.code === 'ENOENT') { return { outcome: 'skipped', detail: 'not on this machine' }; }
    return { outcome: refused(error) ? 'blocked' : 'allowed', detail: error.code || String(error) };
  }
};
(async () => {
  const results = [];
  for (const probe of probes) { results.push({ name: probe.name, ...(await attempt(probe)) }); }
  console.log(JSON.stringify(results));
})();
`;

/**
 * Joins what the script saw with what each probe expected. A probe the script never reported fails.
 */
export const judgeSelftest = (probes: Probe[], output: string): ProbeResult[] => {
  const seen = parseResults(output);
  return probes.map((probe) => {
    const result = seen.get(probe.name);
    const outcome = result?.outcome ?? 'skipped';
    return {
      ...probe,
      outcome,
      detail: result?.detail ?? 'no result from the selftest script',
      ok: result !== undefined && (outcome === probe.expect || (outcome === 'skipped' && probe.expect === 'blocked'))
    };
  });
};

const parseResults = (output: string): Map<string, { outcome: Expect | 'skipped'; detail: string }> => {
  const line = output
    .trim()
    .split('\n')
    .findLast((candidate) => candidate.startsWith('['));
  try {
    const rows = JSON.parse(line ?? '[]') as { name: string; outcome: Expect | 'skipped'; detail: string }[];
    return new Map(rows.map((row) => [row.name, { outcome: row.outcome, detail: row.detail }]));
  } catch {
    return new Map();
  }
};
