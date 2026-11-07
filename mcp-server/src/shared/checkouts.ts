import { configuredRepoPaths } from '@/config';
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/**
 * Every checkout that carries `marker`, by folder name: the configured repos, then their sibling worktrees
 * (`<repo>-<branch>`).
 */
export const checkoutsCarrying = (marker: string[]): Map<string, string> =>
  new Map(
    configuredRepoPaths()
      .flatMap((repo) => [repo, ...siblingWorktrees(repo)])
      .filter((checkout) => existsSync(resolve(checkout, ...marker)))
      .map((checkout) => [basename(checkout), checkout])
  );

/**
 * The checkout named `name` (or `<primary repo>-<name>`) among `checkouts`, else the primary repo itself
 * (AGENT_CODE_PATH, the first configured).
 */
export const pickCheckout = (checkouts: Map<string, string>, what: string, name?: string): string => {
  const available = [...checkouts.keys()].join(', ') || 'none';
  const primary = basename(configuredRepoPaths()[0] ?? '');
  const found = name ? (checkouts.get(name) ?? checkouts.get(`${primary}-${name}`)) : checkouts.get(primary);

  if (!found) {
    throw new Error(
      name
        ? `No checkout named "${name}" carries ${what}. Available: ${available}.`
        : `${what} not found in the configured checkout. Set AGENT_CODE_PATH to the monorepo, or pass a checkout (available: ${available}).`
    );
  }
  return found;
};

const siblingWorktrees = (repo: string): string[] => {
  try {
    return readdirSync(dirname(repo))
      .filter((entry) => entry.startsWith(`${basename(repo)}-`))
      .map((entry) => resolve(dirname(repo), entry));
  } catch {
    return [];
  }
};
