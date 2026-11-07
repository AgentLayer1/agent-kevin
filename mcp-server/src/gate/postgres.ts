import { createHash } from 'node:crypto';
import { type Docker, dockerClient } from './docker';
import type { GateServices } from './run';
import type { PostgresSettings } from './settings';

/**
 * A Postgres container for one gate run: loopback-only on a port Docker picks, data on tmpfs, removed when the
 * run ends. A container a crashed run left on the same checkout is removed first.
 */
export const throwawayPostgres = (settings: PostgresSettings, checkout: string): GateServices => {
  const checkoutLabel = `agent-gate.checkout=${createHash('sha256').update(checkout).digest('hex').slice(0, 16)}`;
  const state: { container?: string; docker?: Docker } = {};

  return {
    start: async (runId, signal) => {
      const docker = await dockerClient('the gate runs its throwaway Postgres there');
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
        300_000,
        { signal }
      );
      if (started.stopped === 'cancel') {
        throw new Error(`Starting ${settings.image} was cancelled.`);
      }
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
      await waitReady(docker, state.container, settings, signal);

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

// Over TCP: the image's first-boot init server listens on the socket only, so a TCP answer is the real server.
const waitReady = async (
  docker: Docker,
  container: string,
  settings: PostgresSettings,
  signal?: AbortSignal,
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
    if (signal?.aborted) {
      throw new Error(`Waiting for ${settings.image} was cancelled.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`${settings.image} didn't accept connections within ${timeoutMs / 1_000} s.`);
    }
    await Bun.sleep(500);
  }
};
