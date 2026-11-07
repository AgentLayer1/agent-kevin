import { runGroup } from '@/shared/process-group';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { GateServices } from './run';
import type { PostgresSettings } from './settings';
import { SYSTEM_PATH } from './toolchain';

/**
 * A Postgres container for one gate run: loopback-only on a port Docker picks, data on tmpfs, removed when the
 * run ends. A container a crashed run left on the same checkout is removed first.
 */
export const throwawayPostgres = (settings: PostgresSettings, checkout: string): GateServices => {
  const checkoutLabel = `agent-gate.checkout=${createHash('sha256').update(checkout).digest('hex').slice(0, 16)}`;
  const state: { container?: string; docker?: Docker } = {};

  return {
    start: async (runId) => {
      const docker = await dockerClient();
      state.docker = docker;
      const leftovers = (await docker(['ps', '-aq', '--filter', `label=${checkoutLabel}`], 15_000)).stdout
        .split('\n')
        .filter(Boolean);
      if (leftovers.length) {
        await docker(['rm', '-f', ...leftovers], 60_000);
      }

      const started = await docker(
        [
          'run',
          '-d',
          '--rm',
          '--label',
          checkoutLabel,
          '--label',
          `agent-gate.run=${runId}`,
          '-e',
          `POSTGRES_USER=${settings.user}`,
          '-e',
          `POSTGRES_PASSWORD=${settings.password}`,
          '-e',
          `POSTGRES_DB=${settings.database}`,
          '-p',
          '127.0.0.1::5432',
          '--tmpfs',
          '/var/lib/postgresql/data',
          settings.image
        ],
        300_000
      );
      if (started.exitCode !== 0) {
        throw new Error(`Couldn't start ${settings.image}: ${started.stderr.trim().slice(-800)}`);
      }
      state.container = started.stdout.trim();

      const mapped = (await docker(['port', state.container, '5432/tcp'], 15_000)).stdout.match(
        /127\.0\.0\.1:(\d+)/
      )?.[1];
      if (!mapped) {
        throw new Error(`${settings.image} started, but Docker reported no loopback port for it.`);
      }
      await waitReady(docker, state.container, settings);

      const port = Number(mapped);
      const url = `postgresql://${settings.user}:${settings.password}@127.0.0.1:${port}/${settings.database}`;
      return {
        ports: [port],
        env: Object.fromEntries(settings.urlEnv.map((name) => [name, url])),
        summary: `${settings.image} on 127.0.0.1:${port}, removed when the run ends`
      };
    },
    stop: async () => {
      if (state.docker && state.container) {
        await state.docker(['rm', '-f', state.container], 60_000);
      }
    }
  };
};

type Docker = (args: string[], timeoutMs: number) => ReturnType<typeof runGroup>;

// Over TCP: the image's first-boot init server listens on the socket only, so a TCP answer is the real server.
const waitReady = async (
  docker: Docker,
  container: string,
  settings: PostgresSettings,
  timeoutMs = 60_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  const ready = async (): Promise<boolean> =>
    (
      await docker(
        ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', settings.user, '-d', settings.database],
        10_000
      )
    ).exitCode === 0;
  while (!(await ready())) {
    if (Date.now() >= deadline) {
      throw new Error(`${settings.image} didn't accept connections within ${timeoutMs / 1_000} s.`);
    }
    await Bun.sleep(500);
  }
};

const dockerClient = async (): Promise<Docker> => {
  const docker = DOCKER_CANDIDATES.find((candidate) => existsSync(candidate)) ?? Bun.which('docker');
  if (!docker) {
    throw new Error(
      'No docker CLI found. Install and start OrbStack (or Docker Desktop); the gate runs its throwaway Postgres there.'
    );
  }
  // The docker CLI finds its plugins and credential helpers on PATH.
  const env = { HOME: homedir(), PATH: [dirname(docker), ...SYSTEM_PATH].join(':') };
  const run: Docker = (args, timeoutMs) => runGroup([docker, ...args], { cwd: tmpdir(), env, timeoutMs });
  if ((await run(['info', '--format', '{{.ServerVersion}}'], 15_000)).exitCode !== 0) {
    throw new Error(
      'Docker is installed but not running. Start OrbStack (or Docker Desktop), then run the gate again.'
    );
  }
  return run;
};

const DOCKER_CANDIDATES = [
  join(homedir(), '.orbstack', 'bin', 'docker'),
  '/opt/homebrew/bin/docker',
  '/usr/local/bin/docker',
  '/Applications/Docker.app/Contents/Resources/bin/docker'
];
