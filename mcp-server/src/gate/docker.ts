import { type GroupResult, runGroup } from '@/shared/process-group';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SYSTEM_PATH } from './toolchain';

export type Docker = (
  args: string[],
  timeoutMs: number,
  options?: { signal?: AbortSignal; cwd?: string }
) => Promise<GroupResult>;

/**
 * The docker CLI from OrbStack, Homebrew or Docker Desktop, once its daemon answers. `purpose` ends the
 * "not installed" error ("the gate runs its throwaway Postgres there").
 */
export const dockerClient = async (purpose: string): Promise<Docker> => {
  const docker = DOCKER_CANDIDATES.find((candidate) => existsSync(candidate)) ?? Bun.which('docker');
  if (!docker) {
    throw new Error(`No docker CLI found. Install and start OrbStack or Docker Desktop; ${purpose}.`);
  }
  // The docker CLI finds its plugins and credential helpers on PATH.
  const env = { HOME: homedir(), PATH: [dirname(docker), ...SYSTEM_PATH].join(':') };
  const run: Docker = (args, timeoutMs, { signal, cwd = tmpdir() } = {}) =>
    runGroup([docker, ...args], { cwd, env, timeoutMs, signal });
  if ((await run(['info', '--format', '{{.ServerVersion}}'], 15_000)).exitCode !== 0) {
    throw new Error('Docker is installed but not running. Start OrbStack or Docker Desktop, then run the gate again.');
  }
  return run;
};

const DOCKER_CANDIDATES = [
  join(homedir(), '.orbstack', 'bin', 'docker'),
  '/opt/homebrew/bin/docker',
  '/usr/local/bin/docker',
  '/Applications/Docker.app/Contents/Resources/bin/docker'
];
