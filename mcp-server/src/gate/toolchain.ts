import { detectPackageManager, readPkg } from '@/worktree/setup';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

interface Toolchain {
  pm: PackageManager;
  /** The package manager's own binary: the corepack shim beside the pinned Node, or the bun running this server. */
  pmBin: string;
  /** PATH for every sandboxed step: the pinned Node (or bun) first, then the system. */
  path: string;
}

/**
 * The package manager the checkout declares, run from the Node it pins (found through fnm, not the server's PATH,
 * which the session launched with). Fails loud when fnm, the pinned Node or the package manager is missing.
 */
export const resolveToolchain = (checkout: string): Toolchain => {
  const pkg = readPkg(checkout);
  const pm = detectPackageManager(checkout, pkg);
  if (!isPackageManager(pm)) {
    throw new Error(
      `${checkout} declares the package manager "${pm}", which the gate can't run (it runs ${PACKAGE_MANAGERS.join(', ')}).`
    );
  }
  if (pm === 'bun') {
    return { pm, pmBin: process.execPath, path: [dirname(process.execPath), ...SYSTEM_PATH].join(':') };
  }

  const nodeBin = pinnedNodeBin(checkout, pkg.engines?.node);
  const pmBin = join(nodeBin, pm);
  if (!existsSync(pmBin)) {
    throw new Error(`No ${pm} next to ${join(nodeBin, 'node')}. Run corepack enable with that Node active.`);
  }
  return { pm, pmBin, path: [nodeBin, ...SYSTEM_PATH].join(':') };
};

const isPackageManager = (name: string): name is PackageManager => PACKAGE_MANAGERS.some((known) => known === name);

const pinnedNodeBin = (checkout: string, engines: string | undefined): string => {
  const pinFile = ['.nvmrc', '.node-version'].map((name) => join(checkout, name)).find((file) => existsSync(file));
  const using = pinFile ?? engines?.match(/\d+(\.\d+){0,2}/)?.[0];
  if (!using) {
    throw new Error(
      `${checkout} pins no Node (.nvmrc, .node-version or engines.node), so the gate can't tell which Node to run.`
    );
  }
  const fnm = FNM_CANDIDATES.find((candidate) => existsSync(candidate)) ?? Bun.which('fnm');
  if (!fnm) {
    throw new Error(
      `fnm not found (looked in ${FNM_CANDIDATES.join(', ')} and PATH). Install it (brew install fnm) and run fnm install in the repo.`
    );
  }

  const result = Bun.spawnSync([fnm, 'exec', `--using=${using}`, 'node', '-p', 'process.execPath'], { cwd: checkout });
  const node = result.stdout.toString().trim();
  if (result.exitCode !== 0 || !node) {
    throw new Error(
      `fnm has no Node ${pinFile ? `from ${pinFile}` : using} for ${checkout}: run fnm install there. (${result.stderr.toString().trim()})`
    );
  }
  return dirname(node);
};

const FNM_CANDIDATES = [
  '/opt/homebrew/bin/fnm',
  '/usr/local/bin/fnm',
  join(homedir(), '.local', 'share', 'fnm', 'fnm'),
  join(homedir(), '.cargo', 'bin', 'fnm')
];

export const SYSTEM_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
