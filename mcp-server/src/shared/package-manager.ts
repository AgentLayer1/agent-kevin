import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCKFILES = [
  { file: 'bun.lock', pm: 'bun' },
  { file: 'bun.lockb', pm: 'bun' },
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'package-lock.json', pm: 'npm' }
] as const;

export interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  engines?: { node?: string };
}

export const readPkg = (root: string): PackageJson =>
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;

/** The repo's package manager: the `packageManager` field, then the lockfile, then bun. */
export const detectPackageManager = (root: string, pkg: PackageJson): string => {
  const declared = pkg.packageManager?.split('@')[0]?.trim();
  if (declared) {
    return declared;
  }
  const match = LOCKFILES.find(({ file }) => existsSync(join(root, file)));
  return match?.pm ?? 'bun';
};
