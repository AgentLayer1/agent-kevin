/**
 * Path helpers with no dependencies but the standard library.
 *
 * Deliberately a leaf: `config.ts`, `shared/env.ts`, and `shared/utils.ts` all need tilde
 * expansion, and every other home for it creates an import cycle (config imports env; utils
 * imports config). Three copies of the same three lines used to live in those files, and they
 * had already drifted — two handled `~/foo` but not a bare `~`.
 */
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Expand `~` or `~/foo` to an absolute path under the user's home. Other paths pass through. */
export const expandTilde = (path: string): string => {
  if (path === '~') {
    return homedir();
  }
  return path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : path;
};

/** Whether `child` is `parent` or somewhere beneath it (lexical; resolve symlinks first when they matter). */
export const isInside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};
