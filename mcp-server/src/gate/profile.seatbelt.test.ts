import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxProfile } from './profile';

// The rule text can look right while Seatbelt enforces something else (a require-not inside an allow is ignored), so
// this runs the real sandbox. A sandboxed shell can't nest one, so there the suite skips.
const canSandbox =
  process.platform === 'darwin' &&
  Bun.spawnSync(['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)', '/usr/bin/true']).exitCode === 0;

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gate-seatbelt-test-')));
const servers: Server[] = [];
afterAll(() => {
  servers.forEach((server) => server.close());
  rmSync(dir, { recursive: true, force: true });
});

const listening = async (): Promise<number> => {
  const server = createServer((socket) => socket.destroy());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
};

const PROBE = `
const net = require('node:net');
const connect = (port) => new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve('reached'); });
  socket.once('error', (error) => resolve(error.code === 'EPERM' || error.code === 'EACCES' ? 'blocked' : 'reached'));
});
(async () => {
  const own = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => own.listen(0, '127.0.0.1', resolve));
  const results = { taken: await connect(Number(process.argv[1])), allowed: await connect(Number(process.argv[2])), own: await connect(own.address().port) };
  own.close();
  console.log(JSON.stringify(results));
})();
`;

describe.skipIf(!canSandbox)('the profile under the real Seatbelt', () => {
  test("a port already listening is refused, while the run's own service and a port the step opens itself are reached", async () => {
    const taken = await listening();
    const allowed = await listening();
    const profile = join(dir, 'profile.sb');
    writeFileSync(
      profile,
      sandboxProfile({
        checkout: dir,
        scratch: dir,
        network: 'loopback',
        listening: [taken, allowed],
        allowedPorts: [allowed]
      })
    );

    const run = Bun.spawnSync(
      ['/usr/bin/sandbox-exec', '-f', profile, process.execPath, '-e', PROBE, String(taken), String(allowed)],
      {
        cwd: dir,
        env: { PATH: '/usr/bin:/bin', HOME: dir, TMPDIR: dir },
        timeout: 60_000
      }
    );

    expect(run.stdout.toString().trim(), run.stderr.toString()).toBe(
      JSON.stringify({ taken: 'blocked', allowed: 'reached', own: 'reached' })
    );
  }, 120_000);
});
